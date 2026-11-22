/**
 * "Download comparison (Excel)" (wave 37): the comparison tab as one sheet. Supplier prices are confidential, so it
 * needs `prices.view` (audit R9); a sealed two-envelope tender exports quantities and compliance only.
 */
import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";
import { rankOffers } from "@/lib/procurement/award-letters";
import { comparisonFileName, comparisonWorkbook } from "@/lib/procurement/comparison-sheet";
import { PRICE_BASIS_PHRASE } from "@/lib/procurement/landed-cost";
import { normalizeWeights } from "@/lib/procurement/scoring";
import { pricesSealed } from "@/lib/procurement/sealed";
import { loadComparison } from "@/lib/procurement/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const denied = await routeGuard("prices.view");
  if (denied) return denied;
  const id = Number((await params).projectId);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const weights = normalizeWeights(new URL(req.url).searchParams.get("tw") ?? undefined);
  const data = await loadComparison(id, weights);
  if (!data) return new Response("Project not found", { status: 404 });
  const me = await getCurrentUser();
  if (data.project.facilityId != null) {
    const scope = await facilityScope(me);
    if (scope && !scope.includes(data.project.facilityId)) return new Response("You can't see this hospital.", { status: 403 });
  }
  const sealed = pricesSealed(data.project);
  const { evaluation, netEvaluation, landedTotals } = data;
  const ranks = rankOffers([...evaluation.offers.values()].map((s) => ({ offerId: s.offerId, combinedScore: s.combinedScore })));
  // Row cells and scores follow the ranking basis; the net total row always shows the net price.
  const wb = comparisonWorkbook({
    title: `${data.project.code} — ${data.project.title}: comparison of offers`, currency: data.project.currency, priceDate: data.priceDate.date,
    priceBasis: PRICE_BASIS_PHRASE[data.priceBasis], sealed, weights,
    offers: data.offers.map((o) => ({ id: o.id, supplierName: o.supplierName, reference: o.reference, currency: o.currency, incoterm: o.incoterm })),
    items: data.types.map((t) => ({ key: t.id, code: t.code, name: t.name, required: data.required.get(t.id) ?? null })),
    cell: (k, o) => evaluation.rows.find((r) => r.key === k)?.cells.find((c) => c.offerId === o),
    summary: (o) => {
      const s = evaluation.offers.get(o);
      return s ? { ...s, total: netEvaluation.offers.get(o)?.total ?? null } : undefined;
    },
    landed: (o) => landedTotals.get(o)?.total ?? null,
    rank: (o) => ranks.get(o) ?? null,
  });
  const buf = await wb.xlsx.writeBuffer();
  await logActivity("project", id, "comparison_exported", `Comparison of offers downloaded as Excel${sealed ? " (prices sealed, not included)" : ""}`);
  const name = comparisonFileName(data.project.code, todayISO());
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
