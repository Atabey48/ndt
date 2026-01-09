export interface Env {
  MY_DB: D1Database;
  ASSETS: Fetcher; // wrangler assets binding
  PDF_BUCKET: R2Bucket; // wrangler r2 binding
}

type Role = "admin" | "user";

type AuthedUser = {
  id: number;
  username: string;
  role: Role;
};

type ToolResult = {
  title: string;
  description: string;
  features: string[];
  source: "aerofabndt" | "technandt" | "internal";
  link: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const nowIso = () => new Date().toISOString();

function isApi(path: string) {
  return path.startsWith("/api/");
}

function safeFileName(name: string) {
  return (name || "document.pdf").replace(/[^\w.\-]+/g, "_");
}

function b64encode(bytes: ArrayBuffer) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin);
}

function b64decodeToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// -------- Password hashing (PBKDF2 via WebCrypto) --------
// Stored format: pbkdf2$iterations$saltB64$hashB64
async function hashPassword(password: string, iterations = 120_000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    256
  );

  const saltB64 = b64encode(salt.buffer);
  const hashB64 = b64encode(bits);
  return `pbkdf2$${iterations}$${saltB64}$${hashB64}`;
}

async function verifyPassword(password: string, stored: string) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1] || "0");
  if (!iterations) return false;

  const salt = b64decodeToBytes(parts[2]);
  const expectedHashB64 = parts[3];

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    256
  );

  const actualHashB64 = b64encode(bits);
  // constant-ish compare
  if (actualHashB64.length !== expectedHashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHashB64.length; i++) diff |= actualHashB64.charCodeAt(i) ^ expectedHashB64.charCodeAt(i);
  return diff === 0;
}

function randomToken() {
  const a = crypto.randomUUID();
  const b = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return `${a}.${b}`;
}

async function logAction(db: D1Database, action_type: string, metadata: Record<string, unknown>, user_id?: number | null) {
  await db
    .prepare("INSERT INTO audit_logs (user_id, action_type, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(user_id ?? null, action_type, JSON.stringify(metadata ?? {}), nowIso())
    .run();
}

async function ensureSeed(env: Env) {
  // Manufacturers
  await env.MY_DB.prepare(
    "INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES (?1, ?2, ?3)"
  )
    .bind("Airbus", "#00205B", "#E5EEF9")
    .run();
  await env.MY_DB.prepare(
    "INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES (?1, ?2, ?3)"
  )
    .bind("Boeing", "#0033A1", "#DCE7F7")
    .run();
  await env.MY_DB.prepare(
    "INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES (?1, ?2, ?3)"
  )
    .bind("Embraer", "#1E3137", "#E7EEF0")
    .run();
  await env.MY_DB.prepare(
    "INSERT OR IGNORE INTO manufacturers (name, theme_primary, theme_secondary) VALUES (?1, ?2, ?3)"
  )
    .bind("Bombardier", "#89674A", "#F2ECE6")
    .run();

  // Aircraft defaults (idempotent)
  const m = await env.MY_DB.prepare("SELECT id, name FROM manufacturers").all<{ id: number; name: string }>();
  const byName = new Map(m.results.map((x) => [x.name, x.id] as const));
  const aircraftSeed: Array<[string, string]> = [
    ["Airbus", "A320 Family"],
    ["Airbus", "A330"],
    ["Airbus", "A350"],
    ["Boeing", "737 NG/MAX"],
    ["Boeing", "777"],
    ["Boeing", "787"],
    ["Embraer", "E-Jets E2"],
    ["Bombardier", "Global"],
  ];

  for (const [mn, an] of aircraftSeed) {
    const mid = byName.get(mn);
    if (!mid) continue;
    await env.MY_DB.prepare("INSERT OR IGNORE INTO aircraft (manufacturer_id, name) VALUES (?1, ?2)")
      .bind(mid, an)
      .run();
  }

  // Default admin/user accounts (idempotent)
  const admin = await env.MY_DB.prepare("SELECT id FROM users WHERE username = 'admin'").first<{ id: number }>();
  if (!admin?.id) {
    const adminHash = await hashPassword("admin123");
    await env.MY_DB.prepare("INSERT INTO users (username, password_hash, role, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind("admin", adminHash, "admin")
      .run();
  }

  const user = await env.MY_DB.prepare("SELECT id FROM users WHERE username = 'user'").first<{ id: number }>();
  if (!user?.id) {
    const userHash = await hashPassword("user123");
    await env.MY_DB.prepare("INSERT INTO users (username, password_hash, role, is_active) VALUES (?1, ?2, ?3, 1)")
      .bind("user", userHash, "user")
      .run();
  }
}

async function getAuthUser(request: Request, env: Env): Promise<{ user: AuthedUser; token: string } | null> {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;

  const token = auth.slice(7).trim();
  if (!token) return null;

  const row = await env.MY_DB.prepare(
    `
    SELECT u.id, u.username, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?1 AND u.is_active = 1
  `
  )
    .bind(token)
    .first<{ id: number; username: string; role: Role }>();

  if (!row?.id) return null;

  // refresh last_seen
  await env.MY_DB.prepare("UPDATE sessions SET last_seen_at = ?1 WHERE token = ?2").bind(nowIso(), token).run();

  return { user: { id: row.id, username: row.username, role: row.role }, token };
}

function requireUser(x: { user: AuthedUser; token: string } | null): asserts x is { user: AuthedUser; token: string } {
  if (!x) throw new Error("UNAUTHORIZED");
}
function requireAdmin(x: { user: AuthedUser; token: string } | null): asserts x is { user: AuthedUser; token: string } {
  if (!x || x.user.role !== "admin") throw new Error("FORBIDDEN");
}

// -------- External HTML parsing using HTMLRewriter (no deps) --------
async function fetchExternalSearch(baseUrl: string, query: string, source: ToolResult["source"]) {
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);

  const res = await fetch(url.toString(), { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return [] as ToolResult[];

  const results: ToolResult[] = [];
  let active = -1;

  const rewriter = new HTMLRewriter()
    .on(".search-result", {
      element() {
        results.push({ title: "", description: "", features: [], source, link: "" });
        active = results.length - 1;
      },
    })
    .on(".search-result h3", {
      text(t) {
        if (active >= 0) results[active].title += t.text;
      },
    })
    .on(".search-result .description", {
      text(t) {
        if (active >= 0) results[active].description += t.text;
      },
    })
    .on(".search-result .tag", {
      text(t) {
        const v = t.text.trim();
        if (active >= 0 && v) results[active].features.push(v);
      },
    })
    .on(".search-result .feature", {
      text(t) {
        const v = t.text.trim();
        if (active >= 0 && v) results[active].features.push(v);
      },
    })
    .on(".search-result a", {
      element(e) {
        if (active < 0) return;
        if (results[active].link) return;
        const href = e.getAttribute("href");
        if (!href) return;
        try {
          results[active].link = new URL(href, url.origin).toString();
        } catch {
          results[active].link = href;
        }
      },
    });

  // consume transformed body to trigger handlers
  await rewriter.transform(res).text();

  // cleanup & limit
  return results
    .map((r) => ({
      ...r,
      title: r.title.trim(),
      description: r.description.trim(),
      features: Array.from(new Set(r.features.map((x) => x.trim()).filter(Boolean))).slice(0, 12),
    }))
    .filter((r) => r.title || r.link)
    .slice(0, 10);
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      await ensureSeed(env);

      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

      const url = new URL(request.url);
      const path = url.pathname;

      // Serve static assets
      if (!isApi(path)) {
        if (path === "/") {
          const u = new URL(request.url);
          u.pathname = "/index.html";
          return env.ASSETS.fetch(new Request(u.toString(), request));
        }
        return env.ASSETS.fetch(request);
      }

      // Health
      if (path === "/api/health") return json({ status: "ok", time: nowIso() });

      // ---- AUTH ----
      if (path === "/api/auth/login" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as null | { username?: string; password?: string };
        const username = (body?.username ?? "").trim();
        const password = (body?.password ?? "").trim();
        if (!username || !password) return json({ error: "Username and password are required." }, 400);

        const u = await env.MY_DB.prepare(
          "SELECT id, username, role, password_hash, is_active FROM users WHERE username = ?1"
        )
          .bind(username)
          .first<{ id: number; username: string; role: Role; password_hash: string; is_active: number }>();

        if (!u?.id) {
          await logAction(env.MY_DB, "LOGIN_FAILED", { username }, null);
          return json({ error: "Invalid credentials." }, 401);
        }

        if (!u.is_active) {
          await logAction(env.MY_DB, "LOGIN_BLOCKED", { username }, u.id);
          return json({ error: "User is inactive." }, 403);
        }

        const ok = await verifyPassword(password, u.password_hash);
        if (!ok) {
          await logAction(env.MY_DB, "LOGIN_FAILED", { username }, u.id);
          return json({ error: "Invalid credentials." }, 401);
        }

        const token = randomToken();
        const ts = nowIso();
        await env.MY_DB.prepare("INSERT INTO sessions (token, user_id, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4)")
          .bind(token, u.id, ts, ts)
          .run();

        await logAction(env.MY_DB, "LOGIN", { username }, u.id);

        return json({ token, user: { id: u.id, username: u.username, role: u.role } });
      }

      if (path === "/api/auth/logout" && request.method === "POST") {
        const auth = await getAuthUser(request, env);
        requireUser(auth);

        await env.MY_DB.prepare("DELETE FROM sessions WHERE token = ?1").bind(auth.token).run();
        await logAction(env.MY_DB, "LOGOUT", {}, auth.user.id);
        return json({ status: "ok" });
      }

      if (path === "/api/me" && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        return json({ user: auth?.user ?? null });
      }

      // ---- ACTIVITY PING ----
      if (path === "/api/activity/ping" && request.method === "POST") {
        const auth = await getAuthUser(request, env);
        requireUser(auth);
        // last_seen updated in getAuthUser already
        return json({ status: "ok", time: nowIso() });
      }

      // ---- MANUFACTURERS + AIRCRAFT ----
      if (path === "/api/manufacturers" && request.method === "GET") {
        const rows = await env.MY_DB.prepare(
          "SELECT id, name, theme_primary, theme_secondary FROM manufacturers ORDER BY name"
        ).all();
        return json(rows.results);
      }

      if (path === "/api/aircraft" && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        requireUser(auth);

        const rows = await env.MY_DB.prepare(
          `
          SELECT 
            a.id, a.name as aircraft_name, a.manufacturer_id,
            m.name as manufacturer_name, m.theme_primary, m.theme_secondary
          FROM aircraft a
          JOIN manufacturers m ON m.id = a.manufacturer_id
          ORDER BY m.name, a.name
        `
        ).all();

        await logAction(env.MY_DB, "VIEW_AIRCRAFT_LIST", { count: rows.results.length }, auth.user.id);
        return json(rows.results);
      }

      // ---- DOCUMENT LIST (by aircraft) ----
      const docsByAircraft = path.match(/^\/api\/aircraft\/(\d+)\/documents$/);
      if (docsByAircraft && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        requireUser(auth);

        const aircraftId = Number(docsByAircraft[1]);
        const rows = await env.MY_DB.prepare(
          `
          SELECT d.id, d.aircraft_id, d.title, d.original_filename, d.revision_date, d.tags, d.uploaded_at, d.uploaded_by
          FROM documents d
          WHERE d.aircraft_id = ?1
          ORDER BY d.uploaded_at DESC
        `
        )
          .bind(aircraftId)
          .all();

        await logAction(env.MY_DB, "VIEW_DOCUMENT_LIST", { aircraftId, count: rows.results.length }, auth.user.id);
        return json(rows.results);
      }

      // ---- UPLOAD DOCUMENT (admin) ----
      if (docsByAircraft && request.method === "POST") {
        const auth = await getAuthUser(request, env);
        requireAdmin(auth);

        const aircraftId = Number(docsByAircraft[1]);

        const fd = await request.formData();
        const title = String(fd.get("title") ?? "").trim();
        const revision_date = String(fd.get("revision_date") ?? "").trim() || null;
        const tags = String(fd.get("tags") ?? "").trim() || null;

        const sections_json = String(fd.get("sections_json") ?? "[]");
        const figures_json = String(fd.get("figures_json") ?? "[]");

        const file = fd.get("file");
        if (!title) return json({ error: "Title is required." }, 400);
        if (!(file instanceof File)) return json({ error: "PDF file is required." }, 400);

        const filename = safeFileName(file.name || "document.pdf");
        const isPdf = (file.type || "").toLowerCase().includes("pdf") || filename.toLowerCase().endsWith(".pdf");
        if (!isPdf) return json({ error: "Only PDF files are allowed." }, 400);

        const storage_key = `pdfs/${crypto.randomUUID()}-${filename}`;

        // Store in R2
        await env.PDF_BUCKET.put(storage_key, await file.arrayBuffer(), {
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: { filename },
        });

        // Insert document row
        const uploaded_at = nowIso();
        const insert = await env.MY_DB.prepare(
          `
          INSERT INTO documents (aircraft_id, title, original_filename, storage_key, revision_date, tags, uploaded_at, uploaded_by)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        `
        )
          .bind(aircraftId, title, filename, storage_key, revision_date, tags, uploaded_at, auth.user.id)
          .run();

        const documentId = Number(insert.meta.last_row_id);

        // Insert sections/figures metadata (sent by UI)
        let sections: Array<{ heading_text: string; page_start?: number; page_end?: number }> = [];
        let figures: Array<{ caption_text?: string; page_number?: number }> = [];

        try {
          const s = JSON.parse(sections_json);
          if (Array.isArray(s)) sections = s;
        } catch {}
        try {
          const f = JSON.parse(figures_json);
          if (Array.isArray(f)) figures = f;
        } catch {}

        if (sections.length) {
          const batch = sections
            .slice(0, 400)
            .map((s, idx) =>
              env.MY_DB.prepare(
                "INSERT INTO sections (document_id, heading_text, page_start, page_end, order_index) VALUES (?1, ?2, ?3, ?4, ?5)"
              ).bind(
                documentId,
                String(s.heading_text || "").trim() || `Section ${idx + 1}`,
                Number.isFinite(s.page_start as any) ? Number(s.page_start) : null,
                Number.isFinite(s.page_end as any) ? Number(s.page_end) : null,
                idx + 1
              )
            );
          await env.MY_DB.batch(batch);
        }

        if (figures.length) {
          const batch = figures
            .slice(0, 400)
            .map((f, idx) =>
              env.MY_DB.prepare(
                "INSERT INTO figures (document_id, page_number, caption_text, order_index) VALUES (?1, ?2, ?3, ?4)"
              ).bind(
                documentId,
                Number.isFinite(f.page_number as any) ? Number(f.page_number) : null,
                String(f.caption_text || "").trim() || null,
                idx + 1
              )
            );
          await env.MY_DB.batch(batch);
        }

        await logAction(
          env.MY_DB,
          "UPLOAD_DOCUMENT",
          { aircraftId, documentId, title, sections: sections.length, figures: figures.length, storage_key },
          auth.user.id
        );

        return json({ status: "ok", documentId });
      }

      // ---- DOCUMENT DETAIL ----
      const docMatch = path.match(/^\/api\/documents\/(\d+)$/);
      if (docMatch && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        requireUser(auth);

        const documentId = Number(docMatch[1]);
        const doc = await env.MY_DB.prepare(
          `
          SELECT id, aircraft_id, title, original_filename, storage_key, revision_date, tags, uploaded_at, uploaded_by
          FROM documents
          WHERE id = ?1
        `
        )
          .bind(documentId)
          .first<any>();

        if (!doc) return json({ error: "Document not found." }, 404);

        const sections = await env.MY_DB.prepare(
          "SELECT id, heading_text, page_start, page_end, order_index FROM sections WHERE document_id = ?1 ORDER BY order_index"
        )
          .bind(documentId)
          .all();

        const figures = await env.MY_DB.prepare(
          "SELECT id, page_number, caption_text, order_index FROM figures WHERE document_id = ?1 ORDER BY order_index"
        )
          .bind(documentId)
          .all();

        await logAction(env.MY_DB, "VIEW_DOCUMENT", { documentId }, auth.user.id);

        return json({
          ...doc,
          pdf_url: `/api/documents/${documentId}/pdf`,
          sections: sections.results,
          figures: figures.results,
        });
      }

      // ---- DOCUMENT PDF (R2) ----
      const pdfMatch = path.match(/^\/api\/documents\/(\d+)\/pdf$/);
      if (pdfMatch && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        requireUser(auth);

        const documentId = Number(pdfMatch[1]);
        const doc = await env.MY_DB.prepare("SELECT storage_key, original_filename FROM documents WHERE id = ?1")
          .bind(documentId)
          .first<{ storage_key: string; original_filename: string }>();

        if (!doc?.storage_key) return json({ error: "PDF not found." }, 404);

        const obj = await env.PDF_BUCKET.get(doc.storage_key);
        if (!obj) return json({ error: "PDF not found in storage." }, 404);

        const headers = new Headers();
        headers.set("Content-Type", "application/pdf");
        headers.set("Content-Disposition", `inline; filename="${safeFileName(doc.original_filename || "document.pdf")}"`);
        headers.set("Cache-Control", "private, max-age=60");

        return new Response(obj.body, { status: 200, headers });
      }

      // ---- DELETE DOCUMENT (admin) ----
      if (docMatch && request.method === "DELETE") {
        const auth = await getAuthUser(request, env);
        requireAdmin(auth);

        const documentId = Number(docMatch[1]);
        const doc = await env.MY_DB.prepare("SELECT storage_key FROM documents WHERE id = ?1")
          .bind(documentId)
          .first<{ storage_key: string }>();

        if (!doc) return json({ error: "Document not found." }, 404);

        await env.MY_DB.prepare("DELETE FROM figures WHERE document_id = ?1").bind(documentId).run();
        await env.MY_DB.prepare("DELETE FROM sections WHERE document_id = ?1").bind(documentId).run();
        await env.MY_DB.prepare("DELETE FROM documents WHERE id = ?1").bind(documentId).run();

        // Remove from R2 (best-effort)
        try {
          await env.PDF_BUCKET.delete(doc.storage_key);
        } catch {}

        await logAction(env.MY_DB, "DELETE_DOCUMENT", { documentId }, auth.user.id);
        return json({ status: "deleted" });
      }

      // ---- ADMIN: USERS ----
      if (path === "/api/admin/users" && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        requireAdmin(auth);

        const rows = await env.MY_DB.prepare(
          "SELECT id, username, role, is_active FROM users ORDER BY username"
        ).all();
        await logAction(env.MY_DB, "ADMIN_VIEW_USERS", { count: rows.results.length }, auth.user.id);
        return json(rows.results);
      }

      if (path === "/api/admin/users" && request.method === "POST") {
        const auth = await getAuthUser(request, env);
        requireAdmin(auth);

        const body = (await request.json().catch(() => null)) as null | {
          username?: string;
          password?: string;
          role?: Role;
          is_active?: boolean;
        };

        const username = (body?.username ?? "").trim();
        const password = (body?.password ?? "").trim();
        const role = (body?.role ?? "user") as Role;
        const is_active = body?.is_active === false ? 0 : 1;

        if (!username || !password) return json({ error: "Username and password are required." }, 400);
        if (role !== "admin" && role !== "user") return json({ error: "Role must be admin or user." }, 400);

        const pwh = await hashPassword(password);

        await env.MY_DB.prepare(
          "INSERT INTO users (username, password_hash, role, is_active) VALUES (?1, ?2, ?3, ?4)"
        )
          .bind(username, pwh, role, is_active)
          .run();

        await logAction(env.MY_DB, "ADMIN_CREATE_USER", { username, role, is_active }, auth.user.id);
        return json({ status: "created", username, role, is_active: !!is_active });
      }

      const userPatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
      if (userPatch && request.method === "PATCH") {
        const auth = await getAuthUser(request, env);
        requireAdmin(auth);

        const userId = Number(userPatch[1]);
        const body = (await request.json().catch(() => null)) as null | {
          is_active?: boolean;
          password?: string;
          role?: Role;
        };

        const updates: string[] = [];
        const binds: any[] = [];

        let idx = 1;

        if (typeof body?.is_active === "boolean") {
          updates.push(`is_active = ?${idx++}`);
          binds.push(body.is_active ? 1 : 0);
        }

        if (typeof body?.role === "string" && (body.role === "admin" || body.role === "user")) {
          updates.push(`role = ?${idx++}`);
          binds.push(body.role);
        }

        if (typeof body?.password === "string" && body.password.trim()) {
          const pwh = await hashPassword(body.password.trim());
          updates.push(`password_hash = ?${idx++}`);
          binds.push(pwh);
        }

        if (!updates.length) return json({ error: "No valid fields to update." }, 400);

        binds.push(userId);
        await env.MY_DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?${idx}`).bind(...binds).run();

        await logAction(env.MY_DB, "ADMIN_UPDATE_USER", { userId, fields: Object.keys(body || {}) }, auth.user.id);
        return json({ status: "ok" });
      }

      // ---- ADMIN: REPORTS (sessions + audit logs) ----
      if (path === "/api/admin/reports/sessions" && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        requireAdmin(auth);

        const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);

        const rows = await env.MY_DB.prepare(
          `
          SELECT
            s.token,
            s.user_id,
            u.username,
            u.role,
            s.created_at,
            s.last_seen_at,
            CAST((julianday(s.last_seen_at) - julianday(s.created_at)) * 86400 AS INTEGER) AS active_seconds
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          ORDER BY s.created_at DESC
          LIMIT ?1
        `
        )
          .bind(limit)
          .all();

        return json(rows.results);
      }

      if (path === "/api/admin/reports/audit" && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        requireAdmin(auth);

        const limit = Math.min(Number(url.searchParams.get("limit") ?? "300"), 800);

        const rows = await env.MY_DB.prepare(
          `
          SELECT
            a.id, a.created_at, a.action_type, a.metadata_json,
            a.user_id, u.username, u.role
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

      // ---- TOOL SEARCH ----
      if (path === "/api/tool/search" && request.method === "GET") {
        const auth = await getAuthUser(request, env);
        requireUser(auth);

        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q) return json({ query: "", results: [] });

        // Internal doc titles/tags
        const internal = await env.MY_DB.prepare(
          `
          SELECT d.id, d.title, d.tags
          FROM documents d
          WHERE d.title LIKE ?1 OR d.tags LIKE ?2
          ORDER BY d.uploaded_at DESC
          LIMIT 10
        `
        )
          .bind(`%${q}%`, `%${q}%`)
          .all<{ id: number; title: string; tags: string }>();

        const internalResults: ToolResult[] = internal.results.map((d) => ({
          title: d.title,
          description: d.tags || "",
          features: [],
          source: "internal",
          link: `/api/documents/${d.id}`,
        }));

        const [aero, tech] = await Promise.all([
          fetchExternalSearch("https://aerofabndt.com/search", q, "aerofabndt"),
          fetchExternalSearch("https://technandt.com/search", q, "technandt"),
        ]);

        const results = [...internalResults, ...aero, ...tech];

        await logAction(env.MY_DB, "TOOL_SEARCH", { q, internal: internalResults.length, aero: aero.length, tech: tech.length }, auth.user.id);

        return json({ query: q, results });
      }

      return json({ error: "Not found." }, 404);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg === "UNAUTHORIZED") return json({ error: "Unauthorized." }, 401);
      if (msg === "FORBIDDEN") return json({ error: "Forbidden." }, 403);
      return json({ error: "Worker error.", detail: msg }, 500);
    }
  },
};
