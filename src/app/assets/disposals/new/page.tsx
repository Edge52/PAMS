import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, disposals, workOrders } from "@/db/schema";
import { Badge, Button, Field, FormGrid, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect } from "@/components/assets/bits";
import { DISPOSAL_METHODS, DISPOSAL_REASONS, METHOD_LABELS, REASON_LABELS } from "@/lib/assets/disposal";
import { assetLifecycle } from "@/lib/assets/lifecycle-server";
import { BAND_LABEL } from "@/lib/assets/lifecycle-kpis";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { CURRENCIES } from "@/lib/format";
import { proposeDisposalAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Propose disposal" };

export default async function NewDisposalPage({ searchParams }: { searchParams: Promise<{ assetId?: string }> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  if (!/^\d+$/.test(sp.assetId ?? "")) notFound();
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, typeName: deviceTypes.name, model: assets.model })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, Number(sp.assetId)));
  if (!a) notFound();
  await requireFacilityAccess(a.facilityId, me);
  const [lc, open, jobs] = await Promise.all([
    assetLifecycle(a.id),
    db.select({ id: disposals.id, number: disposals.number }).from(disposals).where(and(eq(disposals.assetId, a.id), inArray(disposals.status, ["DRAFT", "PENDING_APPROVAL", "APPROVED"]))),
    db.select({ id: workOrders.id, number: workOrders.number }).from(workOrders).where(and(eq(workOrders.assetId, a.id), inArray(workOrders.status, ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]))),
  ]);
  const suggested = lc?.life.state === "BEYOND" ? "END_OF_LIFE" : "BEYOND_REPAIR";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Propose disposal" back={{ href: `/assets/${a.id}`, label: a.tag }}
        description={`${a.typeName}${a.model ? ` · ${a.model}` : ""}. The request goes to the approvers set under Approval rules; the device stays in the register until the disposal is recorded.`} />
      {!can(me.role, "assets.dispose") ? <p className="text-sm text-muted">Your account can&apos;t propose disposals. Ask the biomedical team.</p>
        : a.status === "DISPOSED" ? <p className="text-sm text-muted">{a.tag} has already been disposed of.</p>
        : open.length ? <p className="text-sm">There is already a request for this device: <Link href={`/assets/disposals/${open[0].id}`} className="font-semibold text-primary hover:underline">{open[0].number}</Link>.</p>
        : (
          <>
            {lc && (
              <Panel className="mb-4">
                <p className="text-sm">Replacement score <strong>{lc.score.score}</strong> <Badge tone={lc.score.band === "REPLACE" ? "danger" : lc.score.band === "PLAN" ? "warn" : "ok"}>{BAND_LABEL[lc.score.band]}</Badge></p>
                {lc.score.reasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-muted">{lc.score.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
                {jobs.length > 0 && <p className="mt-2 text-sm text-warn">Open work orders ({jobs.map((j) => j.number).join(", ")}) must be closed or cancelled before the disposal is recorded.</p>}
              </Panel>
            )}
            <Panel>
              <ActionForm action={proposeDisposalAction} className="space-y-4">
                <input type="hidden" name="assetId" value={a.id} />
                <FormGrid cols={2}>
                  <Field label="Reason"><NativeSelect name="reason" value={suggested} options={DISPOSAL_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] }))} /></Field>
                  <Field label="Proposed method"><NativeSelect name="method" value="SCRAP" options={DISPOSAL_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))} /></Field>
                  <Field label="Expected residual value" hint="Sale or trade-in value, if any."><Input type="number" name="estimatedValue" min={0} step="0.01" /></Field>
                  <Field label="Currency"><NativeSelect name="currency" value="EGP" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
                </FormGrid>
                <Field label="Justification" hint="Technical assessment: what failed, repair quotes, availability of parts, safety."><Textarea name="justification" rows={5} required /></Field>
                <Button>Submit for approval</Button>
              </ActionForm>
            </Panel>
          </>
        )}
    </div>
  );
}
