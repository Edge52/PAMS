import Link from "next/link";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { equipmentPlanReviews, equipmentPlans, facilities } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Stat, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { currentPlan, PLAN_STATUS_LABELS, PLAN_STATUS_TONE } from "@/lib/compliance/equipment-plan";
import { GAHAR_EDITION } from "@/lib/compliance/gahar";
import { formatDate, todayISO } from "@/lib/format";
import { createPlanAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment management plan" };

/** The hospital's yearly medical equipment management plan and its evaluations (wave 40, GAHAR EFS.10 EOC 1). */
export default async function EquipmentPlansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || null) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Equipment management plan" /><EmptyState title="No hospital to show">You don&apos;t have access to any hospital yet.</EmptyState></>;
  await requireFacilityAccess(facilityId, me);
  const plans = await db.select().from(equipmentPlans).where(eq(equipmentPlans.facilityId, facilityId)).orderBy(desc(equipmentPlans.year), desc(equipmentPlans.version)).limit(200);
  const reviews = plans.length ? await db.select({ planId: equipmentPlanReviews.planId, n: sql<number>`count(*)::int`, last: sql<string | null>`max(${equipmentPlanReviews.periodTo})::text` })
    .from(equipmentPlanReviews).where(inArray(equipmentPlanReviews.planId, plans.map((p) => p.id))).groupBy(equipmentPlanReviews.planId) : [];
  const rev = new Map(reviews.map((r) => [r.planId, r]));
  const year = Number(todayISO().slice(0, 4));
  const current = currentPlan(plans, year);
  const lastReview = reviews.map((r) => r.last).filter(Boolean).sort().at(-1) ?? null;
  const canEdit = can(me.role, "assets.edit");

  return (
    <>
      <PageHeader title="Equipment management plan"
        description={`The hospital's medical equipment management plan: scope, risk method, maintenance strategy and KPIs with targets, approved every year and evaluated against the figures (${GAHAR_EDITION}, EFS.10).`}
        actions={<Link href={`/reports/gahar?facilityId=${facilityId}`} className="text-sm font-semibold text-primary hover:underline">GAHAR evidence pack</Link>} />
      <Notice sp={sp} />
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label={`Plan for ${year}`} value={current ? PLAN_STATUS_LABELS[current.status] : "None"} href={current ? `/assets/equipment-plan/${current.id}` : undefined} />
        <Stat label="Last evaluation up to" value={lastReview ? formatDate(lastReview) : "None"} />
        <Stat label="Versions on record" value={plans.length} />
      </div>
      {plans.length === 0 ? (
        <EmptyState title="No plan yet">Start this year&apos;s plan below. It begins with suggested text you can change.</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Year</Th><Th>Version</Th><Th>Status</Th><Th>Approved</Th><Th>KPIs</Th><Th>Evaluations</Th></tr></THead>
          <tbody>{plans.map((p) => (
            <tr key={p.id}>
              <Td><Link href={`/assets/equipment-plan/${p.id}`} className="font-semibold text-primary hover:underline">{p.year}</Link></Td>
              <Td>v{p.version}</Td>
              <Td><Badge tone={PLAN_STATUS_TONE[p.status]}>{PLAN_STATUS_LABELS[p.status]}</Badge></Td>
              <Td>{p.approvedAt ? formatDate(p.approvedAt) : "—"}</Td>
              <Td>{p.kpis.length}</Td>
              <Td>{rev.get(p.id)?.n ?? 0}{rev.get(p.id)?.last ? <span className="block text-xs text-muted">up to {formatDate(rev.get(p.id)!.last)}</span> : null}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {canEdit && (
        <div className="mt-6 max-w-xl">
          <Panel title="Start a plan">
            <ActionForm action={createPlanAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="facilityId" value={facilityId} />
              <Field label="Year"><Input type="number" name="year" min={2000} max={2100} defaultValue={year} required /></Field>
              <SubmitButton>Start plan</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">Copies the latest plan of this hospital, or starts from suggested text. A year that has a plan gets a new version.</p>
          </Panel>
        </div>
      )}
    </>
  );
}
