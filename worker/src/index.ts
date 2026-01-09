export interface Env {
  MY_DB: D1Database;
  PDF_BUCKET: R2Bucket;
  ASSETS: Fetcher;
}

/* ----------------------------- helpers ----------------------------- */

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

const text = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...headers, ...corsHeaders } });

const nowISO = () => new Date().toISOString();

const readAuthToken = (req: Request) => {
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim();
};

const randomToken = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

const base64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa works on binary strings
  return btoa(binary);
};

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * PBKDF2-SHA256 password hashing using WebCrypto
 */
async function hashPassword(password: string, saltB64?: string) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 120000,
    },
    keyMaterial,
    256
  );

  return {
    saltB64: btoa(String.fromCharCode(...salt)),
    hashB64: base64(bits),
  };
}

async function verifyPassword(password: string, saltB64: string, hashB64: string) {
  const computed = await hashPassword(password, saltB64);
  return computed.hashB64 === hashB64;
}

async function audit(env: Env, userId: number | null, role: string | null, action: string, req: Request, metadata: unknown = null) {
  const createdAt = nowISO();
  const path = new URL(req.url).pathname;
  await env.MY_DB.prepare(
    "INSERT INTO audit_logs (user_id, role, action_type, path, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
  )
    .bind(userId, role, action, path, metadata ? JSON.stringify(metadata) : null, createdAt)
    .run();
}

async function getSession(env: Env, req: Request) {
  const token = readAuthToken(req);
  if (!token) return null;

  const session = await env.MY_DB.prepare(
    `SELECT s.id as session_id, s.user_id, s.token, s.created_at, s.last_seen_at, s.last_path,
            u.username, u.role, u.is_active
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ?1`
  )
    .bind(token)
    .first<{
      session_id: number;
      user_id: number;
      token: string;
      created_at: string;
      last_seen_at: string;
      last_path: string | null;
      username: string;
      role: "admin" | "user";
      is_active: number;
    }>();

  if (!session) return null;
  if (!session.is_active) return null;
  return session;
}

function requireAdmin(session: { role: string } | null) {
  return session && session.role === "admin";
}

function getClientIP(req: Request) {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For") ||
    req.headers.get("x-real-ip") ||
    ""
  );
}

/* ----------------------------- API ----------------------------- */

async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // OPTIONS
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  // Health (public)
  if (path === "/api/health") {
    return json({ status: "ok", time: nowISO() });
  }

  const session = await getSession(env, req);

  /* --------------------- AUTH --------------------- */

  // POST /api/auth/login
  if (path === "/api/auth/login" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as null | { username?: string; password?: string };
    if (!body?.username || !body?.password) return json({ error: "username and password required" }, 400);

    const user = await env.MY_DB.prepare("SELECT id, username, password_salt, password_hash, role, is_active FROM users WHERE username=?1")
      .bind(body.username)
      .first<{ id: number; username: string; password_salt: string; password_hash: string; role: "admin" | "user"; is_active: number }>();

    if (!user || !user.is_active) {
      await audit(env, null, null, "LOGIN_FAILED", req, { username: body.username });
      return json({ error: "Invalid credentials" }, 401);
    }

    const ok = await verifyPassword(body.password, user.password_salt, user.password_hash);
    if (!ok) {
      await audit(env, user.id, user.role, "LOGIN_FAILED", req, { username: body.username });
      return json({ error: "Invalid credentials" }, 401);
    }

    const token = randomToken();
    const createdAt = nowISO();
    const ip = getClientIP(req);
    const ua = req.headers.get("User-Agent") || "";

    await env.MY_DB.prepare(
      "INSERT INTO sessions (user_id, token, created_at, last_seen_at, last_path, ip, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    )
      .bind(user.id, token, createdAt, createdAt, "/app", ip, ua)
      .run();

    await audit(env, user.id, user.role, "LOGIN_SUCCESS", req, { username: user.username });

    return json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }

  // POST /api/auth/logout
  if (path === "/api/auth/logout" && req.method === "POST") {
    if (!session) return json({ error: "Unauthorized" }, 401);
    await env.MY_DB.prepare("DELETE FROM sessions WHERE token=?1").bind(session.token).run();
    await audit(env, session.user_id, session.role, "LOGOUT", req, {});
    return json({ status: "ok" });
  }

  // All below require auth
  if (!session) return json({ error: "Unauthorized" }, 401);

  /* --------------------- HEARTBEAT (session duration) --------------------- */

  // POST /api/analytics/heartbeat
  if (path === "/api/analytics/heartbeat" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as null | { path?: string };
    const p = body?.path ? String(body.path).slice(0, 200) : null;

    await env.MY_DB.prepare("UPDATE sessions SET last_seen_at=?1, last_path=?2 WHERE token=?3")
      .bind(nowISO(), p, session.token)
      .run();

    // Not auditing every heartbeat to avoid noise
    return json({ status: "ok" });
  }

  /* --------------------- Manufacturers --------------------- */

  // GET /api/manufacturers
  if (path === "/api/manufacturers" && req.method === "GET") {
    const result = await env.MY_DB.prepare("SELECT id, name, theme_primary, theme_secondary FROM manufacturers ORDER BY name").all();
    await audit(env, session.user_id, session.role, "VIEW_MANUFACTURERS", req, { count: result.results.length });
    return json(result.results);
  }

  /* --------------------- Documents --------------------- */

  // GET /api/documents?manufacturer_id=1&q=...
  if (path === "/api/documents" && req.method === "GET") {
    const manufacturerId = url.searchParams.get("manufacturer_id");
    const q = url.searchParams.get("q");

    const filters: string[] = [];
    const bindings: unknown[] = [];

    let sql =
      "SELECT d.id, d.manufacturer_id, d.title, d.revision_date, d.tags, d.original_filename, d.uploaded_at, u.username as uploaded_by " +
      "FROM documents d JOIN users u ON u.id = d.uploaded_by";

    if (manufacturerId) {
      filters.push("d.manufacturer_id = ?");
      bindings.push(Number(manufacturerId));
    }
    if (q) {
      filters.push("d.title LIKE ?");
      bindings.push(`%${q}%`);
    }
    if (filters.length) sql += " WHERE " + filters.join(" AND ");
    sql += " ORDER BY d.uploaded_at DESC";

    const result = await env.MY_DB.prepare(sql).bind(...bindings).all();
    await audit(env, session.user_id, session.role, "VIEW_DOCUMENTS", req, { count: result.results.length, manufacturerId, q });
    return json(result.results);
  }

  // GET /api/documents/:id
  const docMatch = path.match(/^\/api\/documents\/(\d+)$/);
  if (docMatch && req.method === "GET") {
    const id = Number(docMatch[1]);
    const doc = await env.MY_DB.prepare(
      "SELECT id, manufacturer_id, title, revision_date, tags, original_filename, uploaded_at FROM documents WHERE id=?1"
    )
      .bind(id)
      .first();

    if (!doc) return json({ error: "Not found" }, 404);

    await audit(env, session.user_id, session.role, "VIEW_DOCUMENT_DETAIL", req, { id });
    return json(doc);
  }

  // GET /api/documents/:id/pdf
  const pdfMatch = path.match(/^\/api\/documents\/(\d+)\/pdf$/);
  if (pdfMatch && req.method === "GET") {
    const id = Number(pdfMatch[1]);
    const row = await env.MY_DB.prepare("SELECT r2_key, original_filename FROM documents WHERE id=?1")
      .bind(id)
      .first<{ r2_key: string; original_filename: string }>();

    if (!row) return json({ error: "Not found" }, 404);

    const obj = await env.PDF_BUCKET.get(row.r2_key);
    if (!obj) return json({ error: "PDF missing in storage" }, 404);

    await audit(env, session.user_id, session.role, "DOWNLOAD_PDF", req, { id });

    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", "application/pdf");
    headers.set("Content-Disposition", `inline; filename="${row.original_filename}"`);
    return new Response(obj.body, { status: 200, headers });
  }

  /* --------------------- Admin: Users --------------------- */

  // GET /api/admin/users
  if (path === "/api/admin/users" && req.method === "GET") {
    if (!requireAdmin(session)) return json({ error: "Forbidden" }, 403);
    const result = await env.MY_DB.prepare("SELECT id, username, role, is_active, created_at FROM users ORDER BY created_at DESC").all();
    await audit(env, session.user_id, session.role, "ADMIN_VIEW_USERS", req, { count: result.results.length });
    return json(result.results);
  }

  // POST /api/admin/users
  if (path === "/api/admin/users" && req.method === "POST") {
    if (!requireAdmin(session)) return json({ error: "Forbidden" }, 403);

    const body = (await req.json().catch(() => null)) as null | {
      username?: string;
      password?: string;
      role?: "admin" | "user";
    };

    if (!body?.username || !body?.password || !body?.role) {
      return json({ error: "username, password, role required" }, 400);
    }
    if (!["admin", "user"].includes(body.role)) return json({ error: "Invalid role" }, 400);

    const hp = await hashPassword(body.password);

    try {
      await env.MY_DB.prepare(
        "INSERT INTO users (username, password_salt, password_hash, role, is_active, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)"
      )
        .bind(body.username, hp.saltB64, hp.hashB64, body.role, nowISO())
        .run();
    } catch (e) {
      return json({ error: "User create failed (username may already exist)" }, 400);
    }

    await audit(env, session.user_id, session.role, "ADMIN_CREATE_USER", req, { username: body.username, role: body.role });
    return json({ status: "created" });
  }

  /* --------------------- Admin: Upload PDF --------------------- */

  // POST /api/admin/documents (multipart/form-data)
  if (path === "/api/admin/documents" && req.method === "POST") {
    if (!requireAdmin(session)) return json({ error: "Forbidden" }, 403);

    const ct = req.headers.get("Content-Type") || "";
    if (!ct.includes("multipart/form-data")) return json({ error: "multipart/form-data required" }, 400);

    const form = await req.formData();
    const manufacturerId = Number(form.get("manufacturer_id") || 0);
    const title = String(form.get("title") || "").trim();
    const revisionDate = String(form.get("revision_date") || "").trim() || null;
    const tags = String(form.get("tags") || "").trim() || null;
    const file = form.get("file");

    if (!manufacturerId || !title) return json({ error: "manufacturer_id and title required" }, 400);
    if (!(file instanceof File)) return json({ error: "file required" }, 400);
    if (!file.name.toLowerCase().endsWith(".pdf")) return json({ error: "Only PDF allowed" }, 400);

    // Save to R2
    const key = `pdfs/${manufacturerId}/${Date.now()}-${file.name.replaceAll(" ", "_")}`;
    await env.PDF_BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: "application/pdf" },
    });

    // Insert metadata into D1
    await env.MY_DB.prepare(
      `INSERT INTO documents
       (manufacturer_id, title, revision_date, tags, r2_key, original_filename, uploaded_by, uploaded_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
      .bind(manufacturerId, title, revisionDate, tags, key, file.name, session.user_id, nowISO())
      .run();

    await audit(env, session.user_id, session.role, "ADMIN_UPLOAD_PDF", req, {
      manufacturer_id: manufacturerId,
      title,
      key,
      size: file.size,
    });

    return json({ status: "uploaded" });
  }

  /* --------------------- Admin: Audit + Sessions --------------------- */

  // GET /api/admin/audit-logs?limit=200
  if (path === "/api/admin/audit-logs" && req.method === "GET") {
    if (!requireAdmin(session)) return json({ error: "Forbidden" }, 403);
    const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

    const result = await env.MY_DB.prepare(
      `SELECT a.id, a.user_id, a.role, a.action_type, a.path, a.metadata_json, a.created_at, u.username
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT ?1`
    )
      .bind(limit)
      .all();

    return json(result.results);
  }

  // GET /api/admin/sessions?limit=200
  if (path === "/api/admin/sessions" && req.method === "GET") {
    if (!requireAdmin(session)) return json({ error: "Forbidden" }, 403);
    const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

    const result = await env.MY_DB.prepare(
      `SELECT s.id, s.user_id, u.username, u.role,
              s.created_at, s.last_seen_at, s.last_path,
              s.ip, s.user_agent
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.last_seen_at DESC
       LIMIT ?1`
    )
      .bind(limit)
      .all();

    // Duration computed client-side or here:
    const rows = (result.results as any[]).map((r) => {
      const start = new Date(r.created_at).getTime();
      const end = new Date(r.last_seen_at).getTime();
      const seconds = Math.max(0, Math.floor((end - start) / 1000));
      return { ...r, duration_seconds: seconds };
    });

    return json(rows);
  }

  return json({ error: "Not found" }, 404);
}

/* ----------------------------- Asset routing ----------------------------- */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);

      // API routes
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(req, env);
      }

      // App route (serve index)
      if (url.pathname === "/app") {
        const res = await env.ASSETS.fetch(new Request(new URL("/index.html", url).toString(), req));
        return res;
      }

      // Static assets fallback
      const assetRes = await env.ASSETS.fetch(req);
      if (assetRes.status !== 404) return assetRes;

      // Default to index for SPA-like behavior
      const res = await env.ASSETS.fetch(new Request(new URL("/index.html", url).toString(), req));
      return res;
    } catch (e: any) {
      return json({ error: "Worker crashed", detail: String(e?.message || e) }, 500);
    }
  },
};
