import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { getBoqWorkspace, rulesForSet } from "@/lib/boq/queries";
import { buildBoqWorkbook, exportFileName } from "@/lib/boq/export";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await routeGuard("boq.view");
  if (denied) return denied;
  const { id } = await params;
  const boqId = Number(id);
  if (!Number.isInteger(boqId) || boqId <= 0) return new Response("Not found", { status: 404 });
  const ws = await getBoqWorkspace(boqId);
  if (!ws) return new Response("BOQ not found", { status: 404 });
  if (ws.boq.facilityId != null) {
    const scope = await facilityScope(await getCurrentUser());
    if (scope && !scope.includes(ws.boq.facilityId)) return new Response("You can't see this facility.", { status: 403 });
  }
  const wb = await buildBoqWorkbook(ws, await rulesForSet(ws.boq.standardSetId));
  const buf = await wb.xlsx.writeBuffer();
  const name = exportFileName(ws);
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
