export interface Env {
  MY_DB: D1Database;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const nowISO = () => new Date().toISOString();

const randomToken = () => {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
};

type DbUser = { id: number; username: string; role: string };

const ensureSeed = async (db: D1Database) => {
  // manufacturers
  const mCount = await db.prepare("SELECT COUNT(*) as c FROM manufacturers").first<{ c: number }>();
  if ((mCount?.c ?? 0) === 0) {
    const seed = [
      ["Airbus", "#00205B"],
      ["Boeing", "#0033A1"],
      ["Embraer", "#1E3137"],
      ["Bombardier", "#89674a"],
    ];
    await db.batch(
      seed.map((row) => db.prepare("INSERT INTO manufacturers (name, theme_primary) VALUES (?1, ?2)").bind(...row))
    );
  }

  // users (simple plaintext for speed; if you want, later we can PBKDF2)
  const uCount = await db.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
  if ((uCount?.c ?? 0) === 0) {
    await db.batch([
      db.prepare("INSERT INTO users (username, password, role) VALUES (?1, ?2, ?3)").bind("admin", "admin123", "admin"),
      db.prepare("INSERT INTO users (username, password, role) VALUES (?1, ?2, ?3)").bind("user", "user123", "user"),
    ]);
  }
};

const logAction = async (db: D1Database, userId: number | null, action: string, meta: Record<string, unknown>) => {
  await db
    .prepare("INSERT INTO audit_logs (user_id, action_type, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(userId ?? null, action, JSON.stringify(meta), nowISO())
    .run();
};

const getAuthUser = async (request: Request, env: Env): Promise<DbUser | null> => {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;

  const row = await env.MY_DB.prepare(
    `SELECT users.id as id, users.username as username, users.role as role
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?1`
  )
    .bind(token)
    .first<DbUser>();

  return row ?? null;
};

const requireAuth = async (request: Request, env: Env) => {
  const user = await getAuthUser(request, env);
  if (!user) return { error: json({ error: "Unauthorized" }, 401), user: null as any };
  return { error: null as Response | null, user };
};

const requireAdmin = async (request: Request, env: Env) => {
  const { error, user } = await requireAuth(request, env);
  if (error) return { error, user: null as any };
  if (user.role !== "admin") return { error: json({ error: "Admin only" }, 403), user: null as any };
  return { error: null as Response | null, user };
};

export default {
  async fetch(request: Request, env: Env) {
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

      await ensureSeed(env.MY_DB);

      const url = new URL(request.url);
      const path = url.pathname;

      // health
      if (path === "/api/health") return json({ status: "ok" });

      // auth login
      if (path === "/api/auth/login" && request.method === "POST") {
        const body = (await request.json()) as { username: string; password: string };
        if (!body?.username || !body?.password) return json({ error: "username and password required" }, 400);

        const user = await env.MY_DB.prepare("SELECT id, username, role, password FROM users WHERE username=?1")
          .bind(body.username)
          .first<{ id: number; username: string; role: string; password: string }>();

        if (!user || user.password !== body.password) {
          await logAction(env.MY_DB, null, "LOGIN_FAIL", { username: body.username });
          return json({ error: "Invalid credentials" }, 401);
        }

        const token = randomToken();
        await env.MY_DB.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?1, ?2, ?3)")
          .bind(token, user.id, nowISO())
          .run();

        await logAction(env.MY_DB, user.id, "LOGIN_OK", { username: user.username, role: user.role });
        return json({ token, user: { id: user.id, username: user.username, role: user.role } });
      }

      // auth logout
      if (path === "/api/auth/logout" && request.method === "POST") {
        const auth = request.headers.get("Authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        if (token) await env.MY_DB.prepare("DELETE FROM sessions WHERE token=?1").bind(token).run();
        return json({ status: "ok" });
      }

      // manufacturers (auth optional; but we log if logged in)
      if (path === "/api/manufacturers" && request.method === "GET") {
        const user = await getAuthUser(request, env);
        const result = await env.MY_DB.prepare("SELECT id, name, theme_primary FROM manufacturers ORDER BY name").all();
        await logAction(env.MY_DB, user?.id ?? null, "VIEW_MANUFACTURERS", { count: result.results.length });
        return json(result.results);
      }

      // list docs by manufacturer (auth required)
      if (path === "/api/documents" && request.method === "GET") {
        const { error, user } = await requireAuth(request, env);
        if (error) return error;

        const manufacturerId = url.searchParams.get("manufacturer_id");
        if (!manufacturerId) return json({ error: "manufacturer_id required" }, 400);

        const docs = await env.MY_DB.prepare(
          `SELECT id, manufacturer_id, title, pdf_url, revision_date, tags, uploaded_at
           FROM documents
           WHERE manufacturer_id=?1
           ORDER BY uploaded_at DESC`
        )
          .bind(Number(manufacturerId))
          .all();

        await logAction(env.MY_DB, user.id, "VIEW_DOC_LIST", { manufacturer_id: Number(manufacturerId), count: docs.results.length });
        return json(docs.results);
      }

      // document detail (auth required)
      const docMatch = path.match(/^\/api\/documents\/(\d+)$/);
      if (docMatch && request.method === "GET") {
        const { error, user } = await requireAuth(request, env);
        if (error) return error;

        const documentId = Number(docMatch[1]);
        const doc = await env.MY_DB.prepare(
          "SELECT id, manufacturer_id, title, pdf_url, revision_date, tags, uploaded_at FROM documents WHERE id=?1"
        )
          .bind(documentId)
          .first();

        if (!doc) return json({ error: "Document not found" }, 404);

        const sections = await env.MY_DB.prepare(
          "SELECT id, heading_text, heading_level, page_start, page_end, order_index FROM sections WHERE document_id=?1 ORDER BY order_index"
        )
          .bind(documentId)
          .all();

        const figures = await env.MY_DB.prepare(
          "SELECT id, section_id, page_number, caption_text, order_index FROM figures WHERE document_id=?1 ORDER BY order_index"
        )
          .bind(documentId)
          .all();

        await logAction(env.MY_DB, user.id, "VIEW_DOCUMENT", { id: documentId, sections: sections.results.length, figures: figures.results.length });
        return json({ ...doc, sections: sections.results, figures: figures.results });
      }

      // create doc (admin only)
      if (path === "/api/documents" && request.method === "POST") {
        const { error, user } = await requireAdmin(request, env);
        if (error) return error;

        const body = (await request.json()) as {
          manufacturer_id: number;
          title: string;
          pdf_url: string;
          revision_date?: string;
          tags?: string;
          sections?: Array<{
            heading_text: string;
            heading_level?: string;
            page_start?: number | null;
            page_end?: number | null;
            order_index: number;
          }>;
          figures?: Array<{
            section_order_index?: number | null; // map to sections by order_index
            page_number?: number | null;
            caption_text?: string | null;
            order_index: number;
          }>;
        };

        if (!body?.manufacturer_id || !body?.title || !body?.pdf_url) {
          return json({ error: "manufacturer_id, title, pdf_url required" }, 400);
        }

        const uploadedAt = nowISO();
        const insert = await env.MY_DB.prepare(
          `INSERT INTO documents (manufacturer_id, title, pdf_url, revision_date, tags, uploaded_at, uploaded_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        )
          .bind(
            body.manufacturer_id,
            body.title.trim(),
            body.pdf_url.trim(),
            body.revision_date?.trim() ?? null,
            body.tags?.trim() ?? null,
            uploadedAt,
            user.id
          )
          .run();

        const documentId = Number(insert.meta.last_row_id);

        // sections
        const secRows = (body.sections ?? []).slice().sort((a, b) => a.order_index - b.order_index);
        if (secRows.length) {
          await env.MY_DB.batch(
            secRows.map((s) =>
              env.MY_DB.prepare(
                `INSERT INTO sections (document_id, heading_text, heading_level, page_start, page_end, order_index)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
              ).bind(
                documentId,
                s.heading_text,
                s.heading_level ?? "H1",
                s.page_start ?? null,
                s.page_end ?? null,
                s.order_index
              )
            )
          );
        }

        // figures (map section_order_index -> section_id)
        const figRows = (body.figures ?? []).slice().sort((a, b) => a.order_index - b.order_index);
        if (figRows.length) {
          const secMap = new Map<number, number>();
          if (secRows.length) {
            const dbSecs = await env.MY_DB.prepare("SELECT id, order_index FROM sections WHERE document_id=?1")
              .bind(documentId)
              .all<{ id: number; order_index: number }>();
            dbSecs.results.forEach((r) => secMap.set(r.order_index, r.id));
          }

          await env.MY_DB.batch(
            figRows.map((f) => {
              const sectionId =
                f.section_order_index != null && secMap.has(f.section_order_index)
                  ? secMap.get(f.section_order_index)!
                  : null;

              return env.MY_DB.prepare(
                `INSERT INTO figures (document_id, section_id, page_number, caption_text, order_index)
                 VALUES (?1, ?2, ?3, ?4, ?5)`
              ).bind(documentId, sectionId, f.page_number ?? null, f.caption_text ?? null, f.order_index);
            })
          );
        }

        await logAction(env.MY_DB, user.id, "CREATE_DOCUMENT", {
          id: documentId,
          manufacturer_id: body.manufacturer_id,
          title: body.title,
          sections: secRows.length,
          figures: figRows.length,
        });

        return json({ id: documentId, uploaded_at: uploadedAt });
      }

      // tool search (auth required)
      if (path === "/api/tool/search" && request.method === "GET") {
        const { error, user } = await requireAuth(request, env);
        if (error) return error;

        const q = (url.searchParams.get("q") || "").trim();
        if (!q) return json({ error: "q required" }, 400);

        const results: Array<{ title: string; description: string; source: string; link: string; features: string[] }> =
          [];

        // Simple fetch + light parsing (best-effort)
        const fetchText = async (u: string) => {
          const r = await fetch(u, { headers: { "User-Agent": "ndt-document-hub" } });
          if (!r.ok) throw new Error(`fetch failed: ${u}`);
          return await r.text();
        };

        const safeAbs = (base: string, href: string) => {
          try {
            return new URL(href, base).toString();
          } catch {
            return href;
          }
        };

        // Aerofab
        try {
          const base = "https://aerofabndt.com";
          const html = await fetchText(`${base}/search?q=${encodeURIComponent(q)}`);

          // Best-effort: find <a ...>title</a> blocks
          const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([^<]{3,200})<\/a>/gi;
          let m: RegExpExecArray | null;
          let c = 0;
          while ((m = linkRe.exec(html)) && c < 8) {
            const href = m[1];
            const title = m[2].replace(/\s+/g, " ").trim();
            if (!title || title.toLowerCase().includes("search")) continue;
            results.push({ title, description: "", source: "aerofabndt", link: safeAbs(base, href), features: [] });
            c++;
          }
        } catch {
          // ignore
        }

        // Technandt
        try {
          const base = "https://technandt.com";
          const html = await fetchText(`${base}/search?q=${encodeURIComponent(q)}`);

          const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([^<]{3,200})<\/a>/gi;
          let m: RegExpExecArray | null;
          let c = 0;
          while ((m = linkRe.exec(html)) && c < 8) {
            const href = m[1];
            const title = m[2].replace(/\s+/g, " ").trim();
            if (!title || title.toLowerCase().includes("search")) continue;
            results.push({ title, description: "", source: "technandt", link: safeAbs(base, href), features: [] });
            c++;
          }
        } catch {
          // ignore
        }

        if (results.length === 0) {
          results.push({
            title: "No results",
            description: "Search sources returned no parseable results.",
            source: "system",
            link: "#",
            features: [],
          });
        }

        await logAction(env.MY_DB, user.id, "TOOL_SEARCH", { q, count: results.length });
        return json({ query: q, results });
      }

      return json({ error: "Not found" }, 404);
    } catch (err: any) {
      return json({ error: "Worker crashed", message: err?.message ?? String(err) }, 500);
    }
  },
};
