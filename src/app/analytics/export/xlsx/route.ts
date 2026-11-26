import { parseFilters } from "@/lib/analytics/core";
import { analyticsWorkbookData } from "@/lib/analytics/export-server";
import { routeGuard } from "@/lib/auth/route-guard";
import { getCurrentUser } from "@/lib/auth/session";
import { APP_TIME_ZONE, todayISO } from "@/lib/format";
import { exportFileName, reportWorkbook } from "@/lib/reports/excel";

export const dynamic = "force-dynamic";

/** The Analytics figures as .xlsx for the filters in the query string (wave 40). Money only with prices.view. */
export async function GET(request: Request) {
  const denied = await routeGuard("reports.view");
  if (denied) return denied;
  const me = await getCurrentUser();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const today = todayISO();
  const f = parseFilters(Object.fromEntries(new URL(request.url).searchParams), today);
  const data = await analyticsWorkbookData(me, f, today);
  const generated = new Date().toLocaleString("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const buf = await reportWorkbook("Analytics", data, [`Generated ${generated} by ${me.name}`]);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportFileName("analytics", today)}"`,
      "Cache-Control": "no-store",
    },
  });
}
