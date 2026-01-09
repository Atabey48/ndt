export interface Env {
  MY_DB: D1Database;

  // Admin işlemlerini korumak için basit anahtar:
  // Cloudflare'da SECRET olarak tanımlanacak.
  ADMIN_KEY?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const requireAdmin = (request: Request, env: Env) => {
  const key = request.headers.get("X-Admin-Key") || "";
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ error: "Admin only" }, 403);
  }
  return null;
};

const ensureManufacturers = async (db: D1Database) => {
  const existing = await db
    .prepare("SELECT COUNT(*) as count FROM manufacturers")
    .first<{ count: number }>();

  if ((existing?.count ?? 0) > 0) return;

  const seed = [
    ["Boeing", "#0b3d91", "#dce7f7"],
    ["Airbus", "#00205b", "#e5eef9"],
    ["Other", "#2f855a", "#e6fffa"],
  ];

  const batch = seed.map((row) =>
    db
      .prepare("INSERT INTO manufacturers (name, theme_primary, theme_secondary) VALUES (?1, ?2, ?3)")
      .bind(...row)
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
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // Health
      if (path === "/api/health") {
        return json({ status: "ok" });
      }

      // Manufacturers
      if (path === "/api/manufacturers" && request.method === "GET") {
        await ensureManufacturers(env.MY_DB);
        const result = await env.MY_DB.prepare(
          "SELECT id, name, theme_primary, theme_secondary FROM manufacturers ORDER BY name"
        ).all();

        await logAction(env.MY_DB, "VIEW_MANUFACTURERS", { count: result.results.length });
        return json(result.results);
      }

      // List/Search Documents
      if (path === "/api/documents" && request.method === "GET") {
        const manufacturerId = url.searchParams.get("manufacturer_id");
        const q = url.searchParams.get("q");

        let sql = "SELECT * FROM documents";
        const bindings: unknown[] = [];
        const filters: string[] = [];

        if (manufacturerId) {
          filters.push("manufacturer_id = ?1");
          bindings.push(Number(manufacturerId));
        }
        if (q) {
          filters.push(`(title LIKE ?${bindings.length + 1} OR tags LIKE ?${bindings.length + 2})`);
          bindings.push(`%${q}%`, `%${q}%`);
        }

        if (filters.length) sql += ` WHERE ${filters.join(" AND ")}`;
        sql += " ORDER BY uploaded_at DESC";

        const result = await env.MY_DB.prepare(sql).bind(...bindings).all();
        await logAction(env.MY_DB, "VIEW_DOCUMENTS", { count: result.results.length, manufacturerId, q });
        return json(result.results);
      }

      // Create Document (Admin)
      if (path === "/api/documents" && request.method === "POST") {
        const adminCheck = requireAdmin(request, env);
        if (adminCheck) return adminCheck;

        const body = (await request.json()) as {
          manufacturer_id: number;
          title: string;
          pdf_url: string;
          revision_date?: string;
          tags?: string;
        };

        if (!body?.manufacturer_id || !body?.title || !body?.pdf_url) {
          return json({ error: "manufacturer_id, title and pdf_url required" }, 400);
        }

        await ensureManufacturers(env.MY_DB);
        const now = new Date().toISOString();

        const result = await env.MY_DB.prepare(
          "INSERT INTO documents (manufacturer_id, title, pdf_url, revision_date, tags, uploaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        )
          .bind(
            body.manufacturer_id,
            body.title.trim(),
            body.pdf_url.trim(),
            body.revision_date?.trim() ?? null,
            body.tags?.trim() ?? null,
            now
          )
          .run();

        await logAction(env.MY_DB, "CREATE_DOCUMENT", {
          id: result.meta.last_row_id,
          manufacturer_id: body.manufacturer_id,
          title: body.title,
        });

        return json({ id: result.meta.last_row_id, uploaded_at: now });
      }

      // Delete Document (Admin)
      const delMatch = path.match(/^\/api\/documents\/(\d+)$/);
      if (delMatch && request.method === "DELETE") {
        const adminCheck = requireAdmin(request, env);
        if (adminCheck) return adminCheck;

        const documentId = Number(delMatch[1]);

        const existing = await env.MY_DB.prepare("SELECT id FROM documents WHERE id=?1")
          .bind(documentId)
          .first();

        if (!existing) return json({ error: "Document not found" }, 404);

        await env.MY_DB.prepare("DELETE FROM documents WHERE id=?1").bind(documentId).run();

        await logAction(env.MY_DB, "DELETE_DOCUMENT", { id: documentId });
        return json({ status: "deleted" });
      }

      // Document Detail
      const detailMatch = path.match(/^\/api\/documents\/(\d+)$/);
      if (detailMatch && request.method === "GET") {
        const documentId = Number(detailMatch[1]);
        const doc = await env.MY_DB.prepare("SELECT * FROM documents WHERE id=?1").bind(documentId).first();
        if (!doc) return json({ error: "Document not found" }, 404);

        await logAction(env.MY_DB, "VIEW_DOCUMENT", { id: documentId });
        return json(doc);
      }

      return json({ error: "Not found" }, 404);
    } catch (err: any) {
      // 1101 hatası buraya düşen runtime exception'lardır.
      return json(
        {
          error: "Worker crashed",
          message: err?.message ?? String(err),
        },
        500
      );
    }
  },
};
