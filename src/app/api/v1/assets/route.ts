import { apiGet } from "@/lib/api/api-server";
import { apiAssets } from "@/lib/api/data-server";

export const dynamic = "force-dynamic";

/** Read-only API (wave 41): GET /api/v1/assets with a token that has assets:read. See docs/api.md. */
export async function GET(req: Request) {
  return apiGet(req, "assets:read", apiAssets);
}
