export interface Env {
  MY_DB: D1Database;

  // wrangler.toml -> [assets] binding = "ASSETS"
  // @ts-ignore
  ASSETS: Fetcher;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });

const ensureManufacturers = async (db: D1Database) => {
  const existing = await db
    .prepare("SELECT COUNT(*) as count FROM manufacturers")
    .first<{ count: number }>();

  if (existing?.count && existing.count > 0) return;

  const seed = [
    ["Boeing", "#0b3d91", "#dce7f7"],
    ["Airbus", "#00205b", "#e5eef9"],
    ["Other", "#2f855a", "#e6fffa"],
  ];

  const batch = seed.map((row) =>
    db
      .prepare("INSERT INTO manufacturers (name, theme_primary, theme_secondary) VALUES (?1, ?2, ?3)")
      .bind(row[0], row[1], row[2])
  );

  await db.batch(batch);
};

const logAction = async (db: D1Database, action: string, metadata: Record<string, unknown>) => {
  await db
    .prepare("INSERT INTO audit_logs (action_type, metadata_json, created_at) VALUES (?1, ?2, ?3)")
    .bind(action, JSON.stringify(metadata), new Date().toISOString())
    .run();
};

export default {
  async fetch(request: Request, env: Env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ----------------------------
    // API ROUTES
    // ----------------------------
    if (path === "/api/health") {
      return json({ status: "ok" });
    }

    if (path === "/api/manufacturers" && request.method === "GET") {
      await ensureManufacturers(env.MY_DB);

      const result = await env.MY_DB.prepare(
        "SELECT id, name, theme_primary, theme_secondary FROM manufacturers ORDER BY name"
      ).all();

      await logAction(env.MY_DB, "VIEW_MANUFACTURERS", { count: result.results.length });
      return json(result.results);
    }

    if (path === "/api/documents" && request.method === "GET") {
      const manufacturerId = url.searchParams.get("manufacturer_id");
      const query = url.searchParams.get("q");

      let sql = "SELECT * FROM documents";
      const bindings: unknown[] = [];
      const filters: string[] = [];

      if (manufacturerId) {
        filters.push("manufacturer_id = ?");
        bindings.push(Number(manufacturerId));
      }

      if (query) {
        filters.push("title LIKE ?");
        bindings.push(`%${query}%`);
      }

      if (filters.length > 0) sql += ` WHERE ${filters.join(" AND ")}`;
      sql += " ORDER BY uploaded_at DESC";

      const result = await env.MY_DB.prepare(sql).bind(...bindings).all();
      await logAction(env.MY_DB, "VIEW_DOCUMENTS", { count: result.results.length, manufacturerId, query });
      return json(result.results);
    }

    if (path === "/api/documents" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as null | {
        manufacturer_id: number;
        title: string;
        pdf_url?: string;
        revision_date?: string;
        tags?: string;
      };

      if (!body?.manufacturer_id || !body?.title) {
        return json({ error: "manufacturer_id and title required" }, 400);
      }

      await ensureManufacturers(env.MY_DB);

      const now = new Date().toISOString();
      const result = await env.MY_DB.prepare(
        "INSERT INTO documents (manufacturer_id, title, pdf_url, revision_date, tags, uploaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
      )
        .bind(
          body.manufacturer_id,
          body.title,
          body.pdf_url ?? null,
          body.revision_date ?? null,
          body.tags ?? null,
          now
        )
        .run();

      const id = result.meta.last_row_id;
      await logAction(env.MY_DB, "CREATE_DOCUMENT", { id, title: body.title, manufacturer_id: body.manufacturer_id });
      return json({ id, uploaded_at: now });
    }

    // GET /api/documents/:id (detail + sections)
    const docDetailMatch = path.match(/^\/api\/documents\/(\d+)$/);
    if (docDetailMatch && request.method === "GET") {
      const documentId = Number(docDetailMatch[1]);

      const doc = await env.MY_DB.prepare("SELECT * FROM documents WHERE id = ?1")
        .bind(documentId)
        .first();

      if (!doc) return json({ error: "Document not found" }, 404);

      const sections = await env.MY_DB.prepare(
        "SELECT id, heading_text, heading_level, page_start, page_end, order_index FROM sections WHERE document_id = ?1 ORDER BY order_index"
      )
        .bind(documentId)
        .all();

      await logAction(env.MY_DB, "VIEW_DOCUMENT", { id: documentId });
      return json({ ...doc, sections: sections.results });
    }

    // DELETE /api/documents/:id  (UI'daki Sil butonu bunu çağırır)
    const docDeleteMatch = path.match(/^\/api\/documents\/(\d+)$/);
    if (docDeleteMatch && request.method === "DELETE") {
      const documentId = Number(docDeleteMatch[1]);

      await env.MY_DB.prepare("DELETE FROM sections WHERE document_id = ?1").bind(documentId).run();
      const del = await env.MY_DB.prepare("DELETE FROM documents WHERE id = ?1").bind(documentId).run();

      await logAction(env.MY_DB, "DELETE_DOCUMENT", { id: documentId, changes: del.meta.changes });
      return json({ status: "deleted", id: documentId, changes: del.meta.changes });
    }

    // /api ile başlayıp eşleşmeyenler JSON 404
    if (path.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    // ----------------------------
    // STATIC UI (web/) via Assets
    // ----------------------------
    try {
      // @ts-ignore
      const res = await env.ASSETS.fetch(request);

      // SPA fallback sadece HTML navigasyonlarında
      if (res.status === 404) {
        const accept = request.headers.get("Accept") || "";
        if (accept.includes("text/html")) {
          // @ts-ignore
          return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
        }
      }

      return res;
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};
