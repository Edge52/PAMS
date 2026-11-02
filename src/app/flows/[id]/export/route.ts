import { eq } from "drizzle-orm";
import { db } from "@/db";
import { patientFlows } from "@/db/schema";
import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { exportFlow } from "@/lib/flows/server";

export const dynamic = "force-dynamic";

/** A pathway as a file (rooms and departments by code), to import into another hospital or installation. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const fid = Number((await params).id);
  if (!Number.isInteger(fid) || fid <= 0) return new Response("Not found", { status: 404 });
  const [f] = await db.select({ facilityId: patientFlows.facilityId, version: patientFlows.version }).from(patientFlows).where(eq(patientFlows.id, fid));
  if (!f) return new Response("Pathway not found", { status: 404 });
  const scope = await facilityScope(await getCurrentUser());
  if (scope && !scope.includes(f.facilityId)) return new Response("You can't see this hospital.", { status: 403 });
  const file = await exportFlow(fid);
  const name = `${file!.name} v${f.version}.pathway.json`;
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
