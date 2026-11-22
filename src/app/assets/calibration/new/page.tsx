import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, suppliers } from "@/db/schema";
import { Field, FormGrid, Input, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { CALIBRATION_RESULT_LABELS, CALIBRATION_RESULTS, nextCalibrationDue } from "@/lib/assets/calibration";
import { intervalFor, lastCalibration } from "@/lib/assets/calibration-server";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { recordCalibrationAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record a calibration" };

export default async function NewCalibrationPage({ searchParams }: { searchParams: Promise<{ assetId?: string }> }) {
  const me = await requirePermission("maintenance.edit");
  const sp = await searchParams;
  const assetId = Number(sp.assetId);
  if (!Number.isInteger(assetId) || assetId <= 0) notFound();
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, deviceTypeId: assets.deviceTypeId, typeName: deviceTypes.name,
    manufacturer: assets.manufacturer, model: assets.model, needs: deviceTypes.requiresCalibration })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId));
  if (!a) notFound();
  await requireFacilityAccess(a.facilityId, me);
  const today = todayISO();
  const [iv, last, vendors] = await Promise.all([
    intervalFor(a.id, a.deviceTypeId), lastCalibration(a.id),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Record a calibration" back={{ href: `/assets/${a.id}#calibration`, label: a.tag }}
        description={<>Calibration of <b className="font-mono">{a.tag}</b> ({a.typeName}{a.manufacturer || a.model ? `, ${[a.manufacturer, a.model].filter(Boolean).join(" ")}` : ""}). Every {iv.months} months{iv.source === "device" ? " (this device's interval)" : iv.source === "default" ? " (default)" : ""}: a pass today is next due {formatDate(nextCalibrationDue(today, iv.months, "PASS"))}.</>} />
      {!a.needs && <p role="note" className="mb-4 rounded-[var(--radius-control)] border border-line bg-sunken px-3 py-2 text-sm text-muted">This device type is not marked as needing calibration. You can still record one.</p>}
      {last && <p className="mb-4 text-sm text-muted">Last calibration {formatDate(last.calibratedOn)}: {CALIBRATION_RESULT_LABELS[last.result].toLowerCase()}, by {last.performedBy}.</p>}
      <Panel>
        <ActionForm action={recordCalibrationAction} className="space-y-5">
          <input type="hidden" name="assetId" value={a.id} />
          <FormGrid cols={2}>
            <Field label="Calibration date"><Input type="date" name="calibratedOn" required defaultValue={today} max={today} /></Field>
            <Field label="Result"><Select name="result" required placeholder="Choose the result…" options={CALIBRATION_RESULTS.map((r) => ({ value: r, label: CALIBRATION_RESULT_LABELS[r] }))} /></Field>
            <Field label="Done by" hint="The engineer, or the lab or company."><Input name="performedBy" required maxLength={160} defaultValue={me.name} /></Field>
            <Field label="Company"><Select name="vendorId" placeholder="In-house" options={vendors.map((v) => ({ value: v.id, label: v.name }))} /></Field>
            <Field label="Certificate number"><Input name="certificateRef" maxLength={120} /></Field>
          </FormGrid>
          <Field label="Notes" hint="What was adjusted, readings out of tolerance, the reference standard used."><Textarea name="notes" rows={3} /></Field>
          <p className="text-xs text-muted">A failed calibration takes the device out of service. It goes back into service when a passing calibration is recorded. You can attach the certificate on the next page.</p>
          <SubmitButton pendingLabel="Recording…">Record the calibration</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
