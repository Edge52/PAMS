import { apiGet } from "@/lib/api/api-server";
import { apiKpis } from "@/lib/api/data-server";

export const dynamic = "force-dynamic";

/** Read-only API (wave 41): GET /api/v1/analytics/kpis with a token that has analytics:read. See docs/api.md. */
export async function GET(req: Request) {
  return apiGet(req, "analytics:read", apiKpis);
}
