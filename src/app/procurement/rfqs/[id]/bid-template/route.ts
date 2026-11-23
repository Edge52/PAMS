/**
 * "Download bid template (Excel)" (wave 38): one row per RFQ line and one compliance row per specification item,
 * with blank columns for the supplier to fill in. It holds no prices, so `procurement.view` is enough.
 * `?supplierId=` makes it out to one invited supplier (the import then checks the file is theirs).
 */
import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import { bidTemplateFileName, bidTemplateWorkbook } from "@/lib/procurement/bid-import";
import { bidContext } from "@/lib/procurement/bid-import-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await routeGuard("procurement.view");
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const c = await bidContext(id);
  if (!c) return new Response("RFQ not found", { status: 404 });
  const me = await getCurrentUser();
  if (c.project.facilityId != null) {
    const scope = await facilityScope(me);
    if (scope && !scope.includes(c.project.facilityId)) return new Response("You can't see this hospital.", { status: 403 });
  }
  const sid = Number(new URL(req.url).searchParams.get("supplierId"));
  const supplier = sid ? c.invited.find((s) => s.id === sid) ?? null : null;
  if (sid && !supplier) return new Response("That supplier isn't invited to this RFQ.", { status: 404 });
  const wb = bidTemplateWorkbook({
    rfqId: c.rfq.id, rfqNumber: c.rfq.number, title: c.rfq.title, projectCode: c.project.code, closingDate: c.rfq.closingDate, supplier, lines: c.lines,
  });
  const buf = await wb.xlsx.writeBuffer();
  await logActivity("rfq", c.rfq.id, "bid_template", `Bid template downloaded${supplier ? ` for ${supplier.name}` : ""}`);
  const name = bidTemplateFileName(c.rfq.number, supplier?.name ?? null);
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
