import { apiGet } from "@/lib/api/api-server";
import { apiPpm } from "@/lib/api/data-server";

export const dynamic = "force-dynamic";

/** Read-only API (wave 41): GET /api/v1/ppm with a token that has ppm:read. See docs/api.md. */
export async function GET(req: Request) {
  return apiGet(req, "ppm:read", apiPpm);
}
