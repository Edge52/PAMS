import { routeGuard } from "@/lib/auth/route-guard";
import { getCurrentUser } from "@/lib/auth/session";
import { APP_TIME_ZONE } from "@/lib/format";
import { exportFileName, reportWorkbook } from "@/lib/reports/excel";
import { findReport } from "@/lib/reports/registry";
import { runReport } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

/** The report as .xlsx, for the same filters as the page. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const denied = await routeGuard("reports.view");
  if (denied) return denied;
  const me = await getCurrentUser();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const def = findReport((await params).slug);
  if (!def) return new Response("No such report.", { status: 404 });

  const run = await runReport(def, new URL(request.url).searchParams, me);
  if (run.forbidden) return new Response("You can't see that facility.", { status: 403 });
  const generated = new Date().toLocaleString("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const buf = await reportWorkbook(def.title, run.result, [...run.lines, `Generated ${generated} by ${me.name}`]);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportFileName(def.slug, run.today)}"`,
      "Cache-Control": "no-store",
    },
  });
}
