import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { waterPoints } from "@/db/schema";
import { Button, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Crumbs } from "@/components/assets/bits";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { isDialysis, isPointKind, ISO_23500_NOTE, POINT_LABELS } from "@/lib/utilities/water";
import { recordWaterSampleAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record a water sample" };

/** Record one water sample's results; the level is worked out from the point's limits. */
export default async function RecordWaterSamplePage({ searchParams }: { searchParams: Promise<{ pointId?: string }> }) {
  const me = await requirePermission("maintenance.edit");
  const sp = await searchParams;
  const id = Number(sp.pointId);
  const [p] = Number.isInteger(id) && id > 0 ? await db.select().from(waterPoints).where(eq(waterPoints.id, id)) : [];
  if (!p) return <><PageHeader title="Record a water sample" /><EmptyState title="Choose a point">Open the Due list on <Link className="text-primary hover:underline" href="/buildings/water">Water quality</Link> and press Record.</EmptyState></>;
  await requireFacilityAccess(p.facilityId, me);
  const dialysis = isDialysis(p.kind);
  const back = `/buildings/water?facilityId=${p.facilityId}`;
  const lim = (a: number | null, l: number | null) => (l == null ? "" : ` (limit ${l}${a != null ? `, action ${a}` : ""})`);
  return (
    <>
      <Crumbs items={[{ label: "Water quality", href: back }, { label: p.name }]} />
      <PageHeader title="Record a water sample" description={`${p.name} · ${isPointKind(p.kind) ? POINT_LABELS[p.kind] : p.kind}${dialysis ? ` · levels ${ISO_23500_NOTE}` : ""}`} />
      <Panel>
        <ActionForm action={recordWaterSampleAction} className="space-y-4">
          <input type="hidden" name="pointId" value={p.id} />
          <FormGrid cols={3}>
            <Field label="Date sampled"><Input name="sampledOn" type="date" defaultValue={todayISO()} max={todayISO()} required /></Field>
            <Field label="Laboratory"><Input name="lab" maxLength={160} /></Field>
          </FormGrid>
          <p className="text-sm text-muted">Fill in the results you have; leave the others blank.</p>
          <FormGrid cols={3}>
            <Field label={`Total viable count (CFU/mL)${lim(p.tvcAction, p.tvcLimit)}`}><Input name="tvc" type="number" step="any" min="0" inputMode="decimal" /></Field>
            <Field label={`Endotoxin (EU/mL)${lim(p.endotoxinAction, p.endotoxinLimit)}`}><Input name="endotoxin" type="number" step="any" min="0" inputMode="decimal" /></Field>
            <Field label={`Total chlorine (mg/L)${p.chlorineMax != null ? ` (at most ${p.chlorineMax})` : ""}`}><Input name="chlorine" type="number" step="any" min="0" inputMode="decimal" /></Field>
            <Field label={`Free chlorine (mg/L)${p.freeChlorineMin != null ? ` (at least ${p.freeChlorineMin})` : ""}`}><Input name="freeChlorine" type="number" step="any" min="0" inputMode="decimal" /></Field>
            <Field label={`Conductivity (µS/cm)${p.conductivityMax != null ? ` (at most ${p.conductivityMax})` : ""}`}><Input name="conductivity" type="number" step="any" min="0" inputMode="decimal" /></Field>
            <Field label={`Coliforms (per 100 mL)${p.coliformMax != null ? ` (at most ${p.coliformMax})` : ""}`}><Input name="coliforms" type="number" step="any" min="0" inputMode="decimal" /></Field>
          </FormGrid>
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">Other chemical tests (the lab&apos;s panel)</legend>
            <label className="mr-4 inline-flex items-center gap-2"><input type="radio" name="chemistryOk" value="" defaultChecked /> Not done</label>
            <label className="mr-4 inline-flex items-center gap-2"><input type="radio" name="chemistryOk" value="yes" /> Within limits</label>
            <label className="inline-flex items-center gap-2"><input type="radio" name="chemistryOk" value="no" /> Outside limits</label>
          </fieldset>
          <Field label="Notes"><Textarea name="notes" maxLength={2000} /></Field>
          <p className="text-xs text-muted">Attach the lab report to the plant or tank&apos;s documents. A result over a limit opens a work order and tells biomedical.</p>
          <Button>Save result</Button>
        </ActionForm>
      </Panel>
    </>
  );
}
