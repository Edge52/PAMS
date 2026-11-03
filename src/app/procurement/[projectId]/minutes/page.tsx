import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bonds, offers, suppliers } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { Signatures } from "@/components/procurement/signatures";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { normalizeWeights } from "@/lib/procurement/scoring";
import { loadComparison, mandatoryFailures } from "@/lib/procurement/server";
import { tenderDocBase } from "@/lib/procurement/tender-docs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Committee minutes" };

const TITLES = { opening: "Minutes of the opening of envelopes", technical: "Minutes of the technical evaluation", financial: "Minutes of the opening and evaluation of financial envelopes", award: "Minutes of adjudication and award recommendation" } as const;
type Kind = keyof typeof TITLES;
const f1 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));

/**
 * Committee minutes printed from the tender's records (wave 10, Law 182/2018). A draft for the committee to check,
 * complete and sign; the wording is plain, not the regulation's template.
 */
export default async function MinutesPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ kind?: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).projectId);
  const kind = ((await searchParams).kind ?? "opening") as Kind;
  if (!Number.isInteger(id) || !(kind in TITLES)) notFound();
  const base = await tenderDocBase(id);
  if (!base) notFound();
  await requireFacilityAccess(base.project.facilityId, me);
  const p = base.project;
  const sealed = p.twoEnvelope && !p.financialOpenedAt;
  const all = await db.select({ o: offers, supplier: suppliers.name }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.projectId, id)).orderBy(asc(offers.id));
  const bs = all.length ? await db.select().from(bonds).where(and(eq(bonds.projectId, id), inArray(bonds.offerId, all.map((x) => x.o.id)))) : [];
  const cmp = kind === "opening" ? null : await loadComparison(id, normalizeWeights(undefined));
  const fails = new Map(await Promise.all(all.map(async (x) => [x.o.id, kind === "technical" ? await mandatoryFailures(x.o.id) : []] as const)));
  const ranked = cmp ? [...cmp.offers].map((o) => ({ o, s: cmp.evaluation.offers.get(o.id)! })).sort((a, b) => (b.s.combinedScore ?? -1) - (a.s.combinedScore ?? -1)) : [];
  const awarded = all.find((x) => x.o.status === "AWARDED");
  const date = kind === "opening" ? p.technicalOpenedAt : kind === "financial" ? p.financialOpenedAt : null;
  const showPrices = !sealed && (kind === "financial" || kind === "award" || (kind === "opening" && !p.twoEnvelope));

  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/procurement/${id}?tab=tender`} className="text-sm text-primary hover:underline">← Back to the tender</Link>
        {(Object.keys(TITLES) as Kind[]).map((k) => <Link key={k} href={`?kind=${k}`} className={`text-sm ${k === kind ? "font-semibold" : "text-primary hover:underline"}`}>{k[0].toUpperCase() + k.slice(1)}</Link>)}
        <PrintButton />
      </div>
      <article className="mx-auto max-w-3xl rounded border border-line bg-surface p-6 text-sm leading-relaxed print:border-0 print:p-0">
        <header className="mb-4 border-b-2 border-ink pb-2 text-center">
          <p className="text-xs text-muted">{base.facility ?? ""}</p>
          <h1 className="text-lg font-bold">{TITLES[kind]}</h1>
          <p>{p.code} — {p.title}</p>
        </header>
        <p>On {date ? formatDateTime(date) : "……………… at …………"}, the committee met to {kind === "opening" ? "open the envelopes received" : kind === "technical" ? "evaluate the technical offers against the specifications" : kind === "financial" ? "open the financial envelopes of the technically accepted offers and compare prices" : "decide the award and make its recommendation"} for this tender{p.submissionDeadline ? `, whose submission deadline was ${formatDate(p.submissionDeadline)}` : ""}. {p.twoEnvelope ? "The tender uses two envelopes (technical and financial)." : "The tender uses a single envelope."}</p>

        {kind === "opening" && (<>
          <p className="mt-3">{all.length} offer{all.length === 1 ? " was" : "s were"} received:</p>
          <table className="mt-2 w-full border-collapse text-xs">
            <thead><tr className="border-b border-ink text-left"><th className="py-1">#</th><th>Supplier</th><th>Reference and date</th><th>Bid bond</th><th>Valid until</th>{showPrices && <th className="text-right">Total</th>}</tr></thead>
            <tbody>{all.map((x, n) => { const b = bs.filter((y) => y.offerId === x.o.id && y.kind === "BID"); return (
              <tr key={x.o.id} className="border-b border-line/60"><td className="py-1">{n + 1}</td><td>{x.supplier}</td><td>{x.o.reference}, {formatDate(x.o.offerDate)}</td>
                <td>{b.length ? b.map((y) => `${formatMoney(y.amount, y.currency)}${y.bank ? `, ${y.bank}` : ""}`).join("; ") : "none"}</td><td>{formatDate(x.o.validUntil)}</td>
                {showPrices && <td className="text-right">{cmp?.evaluation.offers.get(x.o.id)?.total != null ? formatMoney(cmp.evaluation.offers.get(x.o.id)!.total, p.currency) : "see offer"}</td>}</tr>); })}</tbody>
          </table>
          {p.twoEnvelope && <p className="mt-3">The technical envelopes were opened and initialled. The financial envelopes were kept sealed and signed across by the members, to be opened after the technical evaluation.</p>}
        </>)}

        {kind === "technical" && cmp && (<>
          <p className="mt-3">The committee checked each offer clause by clause against the specifications (the technical evaluation sheet is attached). The result:</p>
          <table className="mt-2 w-full border-collapse text-xs">
            <thead><tr className="border-b border-ink text-left"><th className="py-1">Supplier</th><th className="text-right">Technical score</th><th>Result</th></tr></thead>
            <tbody>{cmp.offers.map((o) => { const s = cmp.evaluation.offers.get(o.id)!; const f = fails.get(o.id) ?? []; return (
              <tr key={o.id} className="border-b border-line/60 align-top"><td className="py-1">{o.supplierName}</td><td className="text-right">{f1(s.technicalScore)} %</td>
                <td>{f.length ? `Technically non-responsive: fails ${f.slice(0, 4).join("; ")}${f.length > 4 ? "…" : ""}` : s.nonResponsiveRows ? `${s.nonResponsiveRows} item(s) non-responsive` : "Technically accepted"}</td></tr>); })}</tbody>
          </table>
        </>)}

        {(kind === "financial" || kind === "award") && cmp && (sealed ? <p className="mt-3 text-warn">The financial envelopes have not been opened yet.</p> : (<>
          <p className="mt-3">Prices after discounts, converted to {p.currency} at the stored exchange rates, and scored with technical and financial weights of {cmp.weights.technical}/{cmp.weights.financial}:</p>
          <table className="mt-2 w-full border-collapse text-xs">
            <thead><tr className="border-b border-ink text-left"><th className="py-1">Rank</th><th>Supplier</th><th className="text-right">Total ({p.currency})</th><th className="text-right">Technical</th><th className="text-right">Financial</th><th className="text-right">Combined</th></tr></thead>
            <tbody>{ranked.map(({ o, s }, n) => (
              <tr key={o.id} className="border-b border-line/60"><td className="py-1">{n + 1}</td><td>{o.supplierName}</td><td className="text-right">{s.total != null ? formatMoney(s.total, p.currency) : "rate missing"}</td>
                <td className="text-right">{f1(s.technicalScore)}</td><td className="text-right">{f1(s.financialScore)}</td><td className="text-right font-semibold">{f1(s.combinedScore)}</td></tr>
            ))}</tbody>
          </table>
          {kind === "award" && <p className="mt-3">{awarded ? <>The committee recommends awarding the tender to <b>{awarded.supplier}</b> (offer {awarded.o.reference}){awarded.o.awardApprovedOn ? `, approved by the competent authority on ${formatDate(awarded.o.awardApprovedOn)}` : ", subject to the competent authority's approval"}.</> : ranked[0] ? <>The highest combined score is <b>{ranked[0].o.supplierName}</b>. The committee recommends ……………………………………………… for the reasons below.</> : null}</p>}
        </>))}

        <p className="mt-4">Remarks: …………………………………………………………………………………………………………………………</p>
        <Signatures committee={base.committeeFor(kind === "opening" ? "opening" : "evaluation")} />
        <p className="mt-6 text-[10px] text-muted">Drafted from the tender records in Hospital PAMS on {formatDate(new Date())} by {me.name}. Check the wording against the Law 182/2018 executive regulations before signing.</p>
      </article>
    </>
  );
}
