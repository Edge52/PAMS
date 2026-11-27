import { apiGet } from "@/lib/api/api-server";
import { apiWorkOrders } from "@/lib/api/data-server";

export const dynamic = "force-dynamic";

/** Read-only API (wave 41): GET /api/v1/work-orders with a token that has workorders:read. See docs/api.md. */
export async function GET(req: Request) {
  return apiGet(req, "workorders:read", apiWorkOrders);
}
