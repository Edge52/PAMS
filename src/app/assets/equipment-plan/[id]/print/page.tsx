import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { equipmentPlanReviews, equipmentPlans, facilities } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/assets/print-button";
import { getApprovalFor } from "@/lib/approvals/server";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { kpiHelp, kpiText, PLAN_STATUS_LABELS } from "@/lib/compliance/equipment-plan";
import { GAHAR_EDITION, GAHAR_NOTE } from "@/lib/compliance/gahar";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Print equipment management plan" };

/** The plan as a printed document (A4 portrait): sections, KPIs, the approval and the latest evaluation. */
export default async function PrintPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [row] = await db.select({ p: equipmentPlans, facility: facilities.name }).from(equipmentPlans).innerJoin(facilities, eq(facilities.id, equipmentPlans.facilityId)).where(eq(equipmentPlans.id, Number(id)));
  if (!row) notFound();
  await requireFacilityAccess(row.p.facilityId, me);
  const p = row.p;
  const [[review], approval] = await Promise.all([
    db.select().from(equipmentPlanReviews).where(eq(equipmentPlanReviews.planId, p.id)).orderBy(desc(equipmentPlanReviews.periodTo)).limit(1),
    getApprovalFor("EQUIPMENT_PLAN", p.id),
  ]);
  const signed = approval?.steps.filter((s) => s.status === "APPROVED") ?? [];
  return (
    <>
      <style>{`
        @page { size: A4; margin: 15mm; }
        @media print {
          #side-nav, button[aria-controls="side-nav"], .no-print { display: none !important; }
          main { padding: 0 !important; }
          body { background: white; }
          .plan-doc { border: 0 !important; box-shadow: none !important; padding: 0 !important; max-width: none !important; }
          .plan-doc section { break-inside: avoid; }
        }
      `}</style>
      <div className="no-print">
        <PageHeader title="Print plan" back={{ href: `/assets/equipment-plan/${p.id}`, label: "Back to the plan" }} actions={<PrintButton label="Print or save as PDF" />} />
      </div>
      <article className="plan-doc max-w-3xl space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-8 text-[14px] leading-relaxed text-ink">
        <header>
          <p className="text-xs text-muted">{row.facility}</p>
          <h1 className="font-display text-2xl font-semibold">Medical equipment management plan {p.year}</h1>
          <p className="text-sm text-muted">Version {p.version} · {PLAN_STATUS_LABELS[p.status]}{p.approvedAt ? ` on ${formatDate(p.approvedAt)}` : ""} · {GAHAR_EDITION}, EFS.10</p>
        </header>
        <section><h2 className="font-semibold">1. Scope</h2><p className="whitespace-pre-line">{p.scope}</p></section>
        <section><h2 className="font-semibold">2. Risk method</h2><p className="whitespace-pre-line">{p.riskMethod}</p></section>
        <section><h2 className="font-semibold">3. Maintenance strategy policy</h2><p className="whitespace-pre-line">{p.maintenanceStrategy}</p></section>
        <section>
          <h2 className="font-semibold">4. Key performance indicators</h2>
          <table className="mt-1 w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-line text-left"><th className="py-1">KPI</th><th className="py-1">Target</th><th className="py-1">How it is measured</th></tr></thead>
            <tbody>{p.kpis.map((k) => <tr key={k.key} className="border-b border-line align-top"><td className="py-1 pr-2">{k.label}</td><td className="py-1 pr-2">{kpiText(k.target, k.unit)}</td><td className="py-1">{kpiHelp(k.key)}</td></tr>)}</tbody>
          </table>
        </section>
        {p.notes && <section><h2 className="font-semibold">5. Notes</h2><p className="whitespace-pre-line">{p.notes}</p></section>}
        {review && (
          <section>
            <h2 className="font-semibold">Latest evaluation: {formatDate(review.periodFrom)} to {formatDate(review.periodTo)}</h2>
            <table className="mt-1 w-full border-collapse text-[13px]">
              <thead><tr className="border-b border-line text-left"><th className="py-1">KPI</th><th className="py-1">Target</th><th className="py-1">Found</th><th className="py-1">Met</th></tr></thead>
              <tbody>{review.kpiSnapshot.map((k) => <tr key={k.key} className="border-b border-line"><td className="py-1 pr-2">{k.label}</td><td className="py-1">{kpiText(k.target, k.unit)}</td><td className="py-1">{kpiText(k.value, k.unit)}</td><td className="py-1">{k.met == null ? "—" : k.met ? "Yes" : "No"}</td></tr>)}</tbody>
            </table>
            {review.findings && <p className="mt-2 whitespace-pre-line"><b>Findings:</b> {review.findings}</p>}
            {review.actions && <p className="whitespace-pre-line"><b>Actions:</b> {review.actions}</p>}
          </section>
        )}
        <section>
          <h2 className="font-semibold">Approval</h2>
          {signed.length ? <ul>{signed.map((s) => <li key={s.id}>{s.label}: {s.decidedByName ?? "—"}{s.decidedAt ? `, ${formatDate(s.decidedAt)}` : ""}</li>)}</ul> : <p className="text-muted">Not approved yet.</p>}
          <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
            <p className="border-t border-ink pt-1">Head of biomedical engineering</p>
            <p className="border-t border-ink pt-1">Hospital director</p>
          </div>
        </section>
        <p className="text-xs text-muted">{GAHAR_NOTE}</p>
      </article>
    </>
  );
}
