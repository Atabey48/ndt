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
      await ensureManufacturers(e
