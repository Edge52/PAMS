import { sql } from "drizzle-orm";
import { db } from "@/db";
import { version } from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Wave 39: health check for Docker and load balancers. No sign-in (src/proxy.ts lets it through) and nothing secret:
 * whether the app and its database answer, the app version and the server time. 503 when the database doesn't.
 */
export async function GET() {
  let ok = true;
  try { await db.execute(sql`select 1`); } catch { ok = false; }
  return Response.json({ ok, db: ok ? "ok" : "down", version, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
