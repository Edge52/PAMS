import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { offerCompliance, offerLines, offers, suppliers } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { Signatures } from "@/components/procurement/signatures";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { EXCLUDED_OFFER_STATUSES } from "@/lib/procurement/labels";
import { technicalEvaluation, type ComplianceStatus } from "@/lib/procurement/scoring";
import { projectSpecs } from "@/lib/procurement/server";
import { tenderDocBase } from "@/lib/procurement/tender-docs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Technical evaluation sheet" };

const MARK: Record<ComplianceStatus, string> = { COMPLIES: "✓", PARTIAL: "~", NOT_COMPLIANT: "✕", NOT_STATED: "?" };
const TONE: Record<ComplianceStatus, string> = { COMPLIES: "text-ok", PARTIAL: "text-warn", NOT_COMPLIANT: "text-danger", NOT_STATED: "text-muted" };

/** Technical evaluation sheet (wave 10, D2): every specification clause against every offer, for the committee to sign. */
export default async function EvaluationSheet({ params }: { params: Promise<{ projectId: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).projectId);
  if (!Number.isInteger(id)) notFound();
  const base = await tenderDocBase(id);
  if (!base) notFound();
  await requireFacilityAccess(base.project.facilityId, me);
  const offs = (await db.select({ id: offers.id, ref: offers.reference, status: offers.status, supplier: suppliers.name }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
    .where(eq(offers.projectId, id)).orderBy(asc(offers.id))).filter((o) => !EXCLUDED_OFFER_STATUSES.includes(o.status));
  const lines = offs.length ? await db.select().from(offerLines).where(inArray(offerLines.offerId, offs.map((o) => o.id))) : [];
  const comp = lines.length ? await db.select().from(offerCompliance).where(inArray(offerCompliance.offerLineId, lines.map((l) => l.id))) : [];
  const specs = await projectSpecs(id);
  const lineOf = (offerId: number, typeId: number) => lines.filter((l) => l.offerId === offerId && l.deviceTypeId === typeId).sort((a, b) => Number(a.isOptional) - Number(b.isOptional))[0];

  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3"><Link href={`/procurement/${id}?tab=tender`} className="text-sm text-primary hover:underline">← Back to the tender</Link><PrintButton /></div>
      <section className="rounded border border-line bg-surface p-5 text-sm print:border-0 print:p-0">
        <header className="mb-4 border-b-2 border-ink pb-2">
          <h1 className="text-lg font-bold">Technical evaluation sheet</h1>
          <p className="text-xs text-muted">{base.project.code} · {base.project.title}{base.facility ? ` · ${base.facility}` : ""} · {formatDate(new Date())}</p>
        </header>
        {specs.size === 0 && <p className="text-warn">No specifications recorded for this tender.</p>}
        {[...specs.entries()].map(([typeId, spec]) => {
          const evs = offs.map((o) => {
            const l = lineOf(o.id, typeId);
            const st = Object.fromEntries(spec.items.map((it) => [it.id, (comp.find((c) => c.offerLineId === l?.id && c.specItemId === it.id)?.status ?? "NOT_STATED") as ComplianceStatus]));
            return { o, l, ev: l ? technicalEvaluation(spec.items.map((it) => ({ id: it.id, mandatory: it.mandatory, weight: it.weight })), st) : null };
          });
          return (
            <div key={typeId} className="mb-6 break-inside-avoid-page">
              <h2 className="mb-1 font-semibold">{spec.title ?? spec.items[0]?.parameter}</h2>
              <div className="overflow-x-auto"><table className="w-full border-collapse text-xs">
                <thead><tr className="border-b border-ink text-left"><th className="py-1 pr-2">Clause</th><th className="pr-2">Required</th>{offs.map((o) => <th key={o.id} className="border-l border-line px-2">{o.supplier}<br /><span className="font-normal text-muted">{o.ref}</span></th>)}</tr></thead>
                <tbody>{spec.items.map((it, n) => (
                  <tr key={it.id} className="border-b border-line/60 align-top">
                    <td className="py-1 pr-2">{n + 1}. {it.parameter}{it.mandatory && <b className="text-primary"> M</b>}</td>
                    <td className="pr-2">{it.requirement}{it.unit && !it.requirement.includes(it.unit) ? ` ${it.unit}` : ""}</td>
                    {evs.map(({ o, l }) => {
                      const c = comp.find((x) => x.offerLineId === l?.id && x.specItemId === it.id); const s = (c?.status ?? "NOT_STATED") as ComplianceStatus;
                      return <td key={o.id} className={`border-l border-line px-2 ${it.mandatory && s === "NOT_COMPLIANT" ? "bg-danger-soft" : ""}`}>{!l ? <span className="text-muted">not offered</span> : <><b className={TONE[s]}>{MARK[s]}</b> {c?.offeredValue ?? ""}{c?.pageRef ? <span className="text-muted"> (p. {c.pageRef.replace(/^p\.?\s*/i, "")})</span> : ""}</>}</td>;
                    })}
                  </tr>
                ))}</tbody>
                <tfoot><tr className="border-t-2 border-ink font-semibold"><td className="py-1" colSpan={2}>Technical score · result</td>
                  {evs.map(({ o, ev }) => <td key={o.id} className="border-l border-line px-2">{!ev ? "—" : <>{ev.score != null ? `${ev.score.toFixed(1)} %` : "—"} · <span className={ev.responsive ? "text-ok" : "text-danger"}>{ev.responsive ? "responsive" : `fails ${ev.mandatoryFailed.length} mandatory`}</span></>}</td>)}</tr></tfoot>
              </table></div>
            </div>
          );
        })}
        <p className="text-[11px] text-muted">✓ complies · ~ partly · ✕ does not comply · ? not stated. M = mandatory: failing one makes the offer technically non-responsive for that item. Page numbers refer to the offer&apos;s datasheets.</p>
        <Signatures committee={base.committeeFor("evaluation")} />
      </section>
    </>
  );
}
