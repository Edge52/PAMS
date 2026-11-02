import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { analysisWorkbook, hospitalAnalysis } from "@/lib/flows/analysis-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const fid = Number(new URL(req.url).searchParams.get("facilityId"));
  if (!Number.isInteger(fid) || fid <= 0) return new Response("Choose a hospital", { status: 400 });
  const scope = await facilityScope(await getCurrentUser());
  if (scope && !scope.includes(fid)) return new Response("You can't see this hospital.", { status: 403 });
  const [fac] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, fid));
  if (!fac) return new Response("Not found", { status: 404 });
  const wb = await analysisWorkbook(fac.name, await hospitalAnalysis(fid));
  const buf = await wb.xlsx.writeBuffer();
  const name = `Pathway analysis - ${fac.name} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
