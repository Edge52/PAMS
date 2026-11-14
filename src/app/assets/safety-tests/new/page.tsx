import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes } from "@/db/schema";
import { Field, FormGrid, Input, LinkButton, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { APPLIED_PART_LABELS, APPLIED_PARTS, CLASS_LABELS, EARTH_LIMIT_OHM, INSULATION_MIN_MOHM, METHOD_LABELS, METHODS, PROTECTION_CLASSES } from "@/lib/assets/safety-tests";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { recordSafetyTestAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record a safety test" };

export default async function NewSafetyTestPage({ searchParams }: { searchParams: Promise<{ assetId?: string; workOrderId?: string }> }) {
  const me = await requirePermission("maintenance.edit");
  const sp = await searchParams;
  const assetId = Number(sp.assetId);
  if (!Number.isInteger(assetId) || assetId <= 0) notFound();
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, typeName: deviceTypes.name, manufacturer: assets.manufacturer, model: assets.model })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId));
  if (!a) notFound();
  await requireFacilityAccess(a.facilityId, me);
  const today = todayISO();
  const analysers = await db.select({ id: assets.id, tag: assets.assetTag, manufacturer: assets.manufacturer, model: assets.model, calibrationDue: assets.calibrationDue })
    .from(assets).where(and(eq(assets.isTestEquipment, true), eq(assets.facilityId, a.facilityId))).orderBy(asc(assets.assetTag));
  const workOrderId = Number(sp.workOrderId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Record a safety test" back={{ href: `/assets/${a.id}`, label: a.tag }}
        description={<>Electrical safety test of <b className="font-mono">{a.tag}</b> ({a.typeName}{a.manufacturer || a.model ? `, ${[a.manufacturer, a.model].filter(Boolean).join(" ")}` : ""}), after IEC 62353. Enter the readings; the app compares them with the limits and says pass or fail.</>} />
      {analysers.length === 0 ? (
        <Panel>
          <p className="text-sm">This hospital has no test equipment on record, so a test can&apos;t be recorded yet.</p>
          <p className="mt-2 text-sm text-muted">Open the safety analyser&apos;s own page in the asset register, tick <b>Test equipment</b> and enter when its calibration runs out.</p>
          <div className="mt-4"><LinkButton href="/assets/safety-tests">Safety tests</LinkButton></div>
        </Panel>
      ) : (
        <Panel>
          <ActionForm action={recordSafetyTestAction} className="space-y-5">
            <input type="hidden" name="assetId" value={a.id} />
            {Number.isInteger(workOrderId) && workOrderId > 0 && <input type="hidden" name="workOrderId" value={workOrderId} />}
            <FormGrid cols={2}>
              <Field label="Test date"><Input type="date" name="testedOn" required defaultValue={today} max={today} /></Field>
              <Field label="Analyser used" hint="Only this hospital's test equipment. One whose calibration has run out is refused.">
                <Select name="analyserAssetId" required placeholder="Choose the analyser…" options={analysers.map((x) => ({ value: x.id, label: `${[x.manufacturer, x.model].filter(Boolean).join(" ") || x.tag} (${x.tag}), calibration ${x.calibrationDue ? `to ${formatDate(x.calibrationDue)}${x.calibrationDue < today ? ", RUN OUT" : ""}` : "not recorded"}` }))} />
              </Field>
              <Field label="Protection class" hint="From the rating plate."><Select name="protectionClass" required placeholder="Choose…" options={PROTECTION_CLASSES.map((c) => ({ value: c, label: CLASS_LABELS[c] }))} /></Field>
              <Field label="Applied part" hint="The part that touches the patient."><Select name="appliedPart" defaultValue="NONE" options={APPLIED_PARTS.map((c) => ({ value: c, label: APPLIED_PART_LABELS[c] }))} /></Field>
              <Field label="Leakage method"><Select name="method" defaultValue="DIRECT" options={METHODS.map((c) => ({ value: c, label: METHOD_LABELS[c] }))} /></Field>
            </FormGrid>
            <fieldset className="rounded-[var(--radius-control)] border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Readings</legend>
              <FormGrid cols={2}>
                <Field label="Protective earth resistance (Ω)" hint={`Class I only. Limit ${EARTH_LIMIT_OHM} Ω with the mains cord.`}><Input name="earthResistanceOhm" inputMode="decimal" placeholder="0.12" /></Field>
                <Field label="Insulation resistance (MΩ)" hint={`If measured. At least ${INSULATION_MIN_MOHM} MΩ unless the maker says otherwise.`}><Input name="insulationMOhm" inputMode="decimal" /></Field>
                <Field label="Equipment leakage current (µA)" hint="Limit: class I 500, class II 100 (direct or differential); 1000 and 500 by the alternative method."><Input name="equipmentLeakageUa" inputMode="decimal" /></Field>
                <Field label="Applied part leakage current (µA)" hint="Type BF limit 5000, type CF limit 50. Not needed for type B or no applied part."><Input name="appliedPartLeakageUa" inputMode="decimal" /></Field>
              </FormGrid>
              <div className="mt-4 space-y-2">
                <label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="visualOk" className="size-5" /> Visual inspection passed: casing, cord, plug, labels, accessories</label>
                <label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="functionalOk" className="size-5" /> Functional test passed</label>
              </div>
            </fieldset>
            <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
            <p className="text-xs text-muted">The limits are the usual IEC 62353 figures. If the maker&apos;s manual states stricter values, judge against those and say so in the notes.</p>
            <SubmitButton pendingLabel="Recording…">Record the test</SubmitButton>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}
