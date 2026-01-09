export interface Env {
  MY_DB: D1Database;
  ASSETS: Fetcher; // wrangler assets binding
}

type Role = "admin" | "user";

type UserRow = {
  id: number;
  username: string;
  role: Role;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const nowIso = () => new Date().toISOString();

const randomToken = () => {
  // UUID + random for good measure
  const a = crypto.randomUUID();
  const b = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return `${a}.${b}`;
};

async function logAction(db: D1Database, action: string, metadata: Record<string, unknown>, userId?: number) {
  try {
    await db
      .prepare("INSERT INTO audit_logs (action_type, metadata_json, created_at, user_id) VALUES (?1, ?2, ?3, ?4)")
      .bind(action, JSON.stringify(metadata ?? {}), nowIso(), userId ?? null)
      .run();
  } catch {
    // In case migration not applied yet, avoid crashing production
    await db
      .prepare("INSERT INTO audit_logs (action_type, metadata_json, created_at) VALUES (?1, ?2, ?3)")
      .bind(action, JSON.stringify(metadata ?? {}), nowIso())
      .run();
  }
}

async function ensureManufacturers(db: D1Database) {
  const existing = await db.prepare("SELECT COUNT(*) as count FROM manufacturers").first<{ count: number }>();
  if (existing?.count && existing.count > 0) return;

  const seed = [
    ["Airbus", "#00205B", "#E5EEF9"],
    ["Boeing", "#0033A1", "#DCE7F7"],
    ["Embraer", "#1E3137", "#E7EEF0"],
    ["Bombardier", "#89674a", "#F2ECE6"],
  ];

  const batch = seed.map((row) =>
    db.prepare("INSERT INTO manufacturers (name, theme_primary, theme_secondary) VALUES (?1, ?2, ?3)").bind(...row)
  );
  await db.batch(batch);
}

async function getAuthUser(request: Request, env: Env): Promise<UserRow | null> {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const sess = await env.MY_DB.prepare("SELECT user_id FROM sessions WHERE token = ?1").bind(token).first<{
    user_id: number;
  }>();
  if (!sess?.user_id) return null;

  const user = await env.MY_DB.prepare("SELECT id, username, role FROM users WHERE id = ?1")
    .bind(sess.user_id)
    .first<UserRow>();

  return user ?? null;
}

function requireUser(user: UserRow | null): asserts user is UserRow {
  if (!user) throw new Error("UNAUTHORIZED");
}

function requireAdmin(user: UserRow | null): asserts user is UserRow {
  if (!user || user.role !== "admin") throw new Error("FORBIDDEN");
}

function isApi(path: string) {
  return path.startsWith("/api/");
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

      const url = new URL(request.url);
      const path = url.pathname;

      // Serve static assets (UI)
      if (!isApi(path)) {
        // Map "/" -> "/index.html"
        if (path === "/") {
          const u = new URL(request.url);
          u.pathname = "/index.html";
          return env.ASSETS.fetch(new Request(u.toString(), request));
        }
        return env.ASSETS.fetch(request);
      }

      // API routes
      if (path === "/api/health") return json({ status: "ok", time: nowIso() });

      // --- AUTH ---
      if (path === "/api/auth/login" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as null | { username?: string; password?: string };
        const username = (body?.username ?? "").trim();
        const password = (body?.password ?? "").trim();
        if (!username || !password) return json({ error: "username and password required" }, 400);

        const user = await env.MY_DB.prepare("SELECT id, username, role, password FROM users WHERE username = ?1")
          .bind(username)
          .first<{ id: number; username: string; role: Role; password: string }>();

        if (!user || user.password !== password) {
          await logAction(env.MY_DB, "LOGIN_FAILED", { username }, undefined);
          return json({ error: "invalid credentials" }, 401);
        }

        const token = randomToken();
        await env.MY_DB.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?1, ?2, ?3)")
          .bind(token, user.id, nowIso())
          .run();

        await logAction(env.MY_DB, "LOGIN", { username }, user.id);

        return json({
          token,
          user: { id: user.id, username: user.username, role: user.role },
        });
      }

      if (path === "/api/auth/logout" && request.method === "POST") {
        const user = await getAuthUser(request, env);
        requireUser(user);

        const auth = request.headers.get("Authorization")!;
        const token = auth.slice(7).trim();

        await env.MY_DB.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
        await logAction(env.MY_DB, "LOGOUT", {}, user.id);
        return json({ status: "ok" });
      }

      if (path === "/api/me" && request.method === "GET") {
        const user = await getAuthUser(request, env);
        if (!user) return json({ user: null });
        return json({ user });
      }

      // --- MANUFACTURERS (public, but logs if authed) ---
      if (path === "/api/manufacturers" && request.method === "GET") {
        await ensureManufacturers(env.MY_DB);
        const result = await env.MY_DB.prepare(
          "SELECT id, name, theme_primary, theme_secondary FROM manufacturers ORDER BY name"
        ).all();
        const user = await getAuthUser(request, env);
        await logAction(env.MY_DB, "VIEW_MANUFACTURERS", { count: result.results.length }, user?.id);
        return json(result.results);
      }

      // --- USERS (admin) ---
      if (path === "/api/admin/users" && request.method === "GET") {
        const user = await getAuthUser(request, env);
        requireAdmin(user);

        const rows = await env.MY_DB.prepare("SELECT id, username, role FROM users ORDER BY username").all();
        await logAction(env.MY_DB, "ADMIN_VIEW_USERS", { count: rows.results.length }, user.id);
        return json(rows.results);
      }

      if (path === "/api/admin/users" && request.method === "POST") {
        const user = await getAuthUser(request, env);
        requireAdmin(user);

        const body = (await request.json().catch(() => null)) as null | {
          username?: string;
          password?: string;
          role?: Role;
        };
        const username = (body?.username ?? "").trim();
        const password = (body?.password ?? "").trim();
        const role = (body?.role ?? "user") as Role;

        if (!username || !password) return json({ error: "username and password required" }, 400);
        if (role !== "admin" && role !== "user") return json({ error: "role must be admin|user" }, 400);

        await env.MY_DB.prepare("INSERT INTO users (username, password, role) VALUES (?1, ?2, ?3)")
          .bind(username, password, role)
          .run();

        await logAction(env.MY_DB, "ADMIN_CREATE_USER", { username, role }, user.id);
        return json({ status: "created", username, role });
      }

      // --- ACTIVITY (admin) ---
      if (path === "/api/admin/activity" && request.method === "GET") {
        const user = await getAuthUser(request, env);
        requireAdmin(user);

        const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);
        const rows = await env.MY_DB.prepare(
          `
          SELECT 
            a.id, a.action_type, a.created_at, a.metadata_json,
            a.user_id,
            u.username as username,
            u.role as role
          FROM audit_logs a
          LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.created_at DESC
          LIMIT ?1
        `
        )
          .bind(limit)
          .all();

        return json(rows.results);
      }

      // --- DOCUMENTS ---
      if (path === "/api/documents" && request.method === "GET") {
        const user = await getAuthUser(request, env);
        requireUser(user);

        const manufacturerId = url.searchParams.get("manufacturer_id");
        const q = url.searchParams.get("q");

        const filters: string[] = [];
        const bind: unknown[] = [];
        let sql = "SELECT * FROM documents";

        if (manufacturerId) {
          filters.push("manufacturer_id = ?1");
          bind.push(Number(manufacturerId));
        }
        if (q) {
          filters.push("(title LIKE ? OR tags LIKE ?)");
          bind.push(`%${q}%`, `%${q}%`);
        }

        if (filters.length) {
          sql += " WHERE " + filters.join(" AND ");
        }
        sql += " ORDER BY uploaded_at DESC";

        const stmt = env.MY_DB.prepare(sql).bind(...bind);
        const result = await stmt.all();

        await logAction(env.MY_DB, "VIEW_DOCUMENTS", { count: result.results.length, manufacturerId, q }, user.id);
        return json(result.results);
      }

      if (path === "/api/documents" && request.method === "POST") {
        const user = await getAuthUser(request, env);
        requireAdmin(user);

        const body = (await request.json().catch(() => null)) as null | {
          manufacturer_id?: number;
          title?: string;
          pdf_url?: string;
          revision_date?: string;
          tags?: string;
          sections?: Array<{ heading_text: string; page_start?: number; page_end?: number }>;
          figures?: Array<{ caption_text?: string; page_number?: number; section_index?: number }>;
        };

        const manufacturer_id = Number(body?.manufacturer_id ?? 0);
        const title = (body?.title ?? "").trim();
        if (!manufacturer_id || !title) return json({ error: "manufacturer_id and title required" }, 400);

        await ensureManufacturers(env.MY_DB);

        const uploaded_at = nowIso();
        const insert = await env.MY_DB.prepare(
          `
          INSERT INTO documents (manufacturer_id, title, pdf_url, revision_date, tags, uploaded_at, uploaded_by)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        `
        )
          .bind(
            manufacturer_id,
            title,
            (body?.pdf_url ?? "").trim() || null,
            (body?.revision_date ?? "").trim() || null,
            (body?.tags ?? "").trim() || null,
            uploaded_at,
            user.id
          )
          .run();

        const documentId = Number(insert.meta.last_row_id);

        // Optional sections insertion
        const sections = Array.isArray(body?.sections) ? body!.sections! : [];
        if (sections.length) {
          const batch = sections.map((s, idx) =>
            env.MY_DB.prepare(
              "INSERT INTO sections (document_id, heading_text, heading_level, page_start, page_end, order_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
            ).bind(documentId, s.heading_text, "H1", s.page_start ?? null, s.page_end ?? null, idx + 1)
          );
          await env.MY_DB.batch(batch);
        }

        // Optional figures insertion
        const figures = Array.isArray(body?.figures) ? body!.figures! : [];
        if (figures.length) {
          const batch = figures.map((f, idx) =>
            env.MY_DB.prepare(
              "INSERT INTO figures (document_id, section_id, page_number, caption_text, order_index) VALUES (?1, ?2, ?3, ?4, ?5)"
            ).bind(
              documentId,
              null, // section_id mapping can be added later
              f.page_number ?? null,
              (f.caption_text ?? "").trim() || null,
              idx + 1
            )
          );
          await env.MY_DB.batch(batch);
        }

        await logAction(
          env.MY_DB,
          "CREATE_DOCUMENT",
          { documentId, manufacturer_id, title, sections: sections.length, figures: figures.length },
          user.id
        );

        return json({ id: documentId, uploaded_at });
      }

      const docMatch = path.match(/^\/api\/documents\/(\d+)$/);
      if (docMatch && request.method === "GET") {
        const user = await getAuthUser(request, env);
        requireUser(user);

        const documentId = Number(docMatch[1]);
        const doc = await env.MY_DB.prepare("SELECT * FROM documents WHERE id = ?1").bind(documentId).first();
        if (!doc) return json({ error: "Document not found" }, 404);

        const sections = await env.MY_DB.prepare(
          "SELECT id, heading_text, heading_level, page_start, page_end, order_index FROM sections WHERE document_id = ?1 ORDER BY order_index"
        )
          .bind(documentId)
          .all();

        const figures = await env.MY_DB.prepare(
          "SELECT id, page_number, caption_text, order_index FROM figures WHERE document_id = ?1 ORDER BY order_index"
        )
          .bind(documentId)
          .all();

        await logAction(env.MY_DB, "VIEW_DOCUMENT", { documentId }, user.id);

        return json({ ...doc, sections: sections.results, figures: figures.results });
      }

      if (docMatch && request.method === "DELETE") {
        const user = await getAuthUser(request, env);
        requireAdmin(user);

        const documentId = Number(docMatch[1]);

        await env.MY_DB.prepare("DELETE FROM figures WHERE document_id = ?1").bind(documentId).run();
        await env.MY_DB.prepare("DELETE FROM sections WHERE document_id = ?1").bind(documentId).run();
        await env.MY_DB.prepare("DELETE FROM documents WHERE id = ?1").bind(documentId).run();

        await logAction(env.MY_DB, "DELETE_DOCUMENT", { documentId }, user.id);
        return json({ status: "deleted" });
      }

      // --- TOOL SEARCH (server-side; simple internal + external links) ---
      if (path === "/api/tool/search" && request.method === "GET") {
        const user = await getAuthUser(request, env);
        requireUser(user);

        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q) return json({ query: "", results: [] });

        // internal docs
        const docs = await env.MY_DB.prepare(
          "SELECT id, title, tags, pdf_url, revision_date FROM documents WHERE title LIKE ?1 OR tags LIKE ?2 ORDER BY uploaded_at DESC LIMIT 20"
        )
          .bind(`%${q}%`, `%${q}%`)
          .all();

        const results = [
          ...docs.results.map((d: any) => ({
            type: "internal",
            title: d.title,
            description: d.tags ?? "",
            link: d.pdf_url ?? "",
            meta: { document_id: d.id, revision_date: d.revision_date ?? "" },
          })),
          {
            type: "external",
            title: "Aerofab NDT Search",
            description: "Open external search page",
            link: `https://aerofabndt.com/search?q=${encodeURIComponent(q)}`,
            meta: {},
          },
          {
            type: "external",
            title: "TechNDT Search",
            description: "Open external search page",
            link: `https://technandt.com/search?q=${encodeURIComponent(q)}`,
            meta: {},
          },
        ];

        await logAction(env.MY_DB, "TOOL_SEARCH", { q, internal_count: docs.results.length }, user.id);
        return json({ query: q, results });
      }

      return json({ error: "Not found" }, 404);
    } catch (err: any) {
      const msg = String(err?.message ?? err);

      if (msg === "UNAUTHORIZED") return json({ error: "unauthorized" }, 401);
      if (msg === "FORBIDDEN") return json({ error: "forbidden" }, 403);

      // Cloudflare 1101 (Worker exception) prevention: always respond JSON
      return json({ error: "worker_error", detail: msg }, 500);
    }
  },
};
