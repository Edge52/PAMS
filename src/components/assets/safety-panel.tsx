import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { incidents, safetyTests } from "@/db/schema";
import { Badge, Field, FormGrid, Input, LinkButton, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { HARM_LABELS, HARM_TONE, INCIDENT_STATUS_LABELS } from "@/lib/assets/incidents";
import { APPLIED_PART_LABELS, CLASS_LABELS, testDueState } from "@/lib/assets/safety-tests";
import { formatDate, todayISO } from "@/lib/format";
import { setTestEquipmentAction } from "@/app/assets/safety-tests/actions";

/** Safety records of one device (wave 23): its electrical safety tests and its incidents. Server component. */
export async function SafetyPanel({ assetId, canTest, canReport, disposed }: { assetId: number; canTest: boolean; canReport: boolean; disposed: boolean }) {
  const [tests, incs] = await Promise.all([
    db.select().from(safetyTests).where(eq(safetyTests.assetId, assetId)).orderBy(desc(safetyTests.testedOn), desc(safetyTests.id)).limit(10),
    db.select().from(incidents).where(eq(incidents.assetId, assetId)).orderBy(desc(incidents.occurredAt)).limit(10),
  ]);
  const today = todayISO(), last = tests[0];
  const state = last ? (last.result === "FAIL" ? null : testDueState(last.nextDue, today)) : "never";
  return (
    <>
      <Panel title={<span id="safety-tests">Electrical safety tests</span>} padded={false}
        actions={<>
          {last?.result === "FAIL" ? <Badge tone="danger">Last test failed</Badge> : state === "overdue" ? <Badge tone="danger">Test overdue</Badge> : state === "soon" ? <Badge tone="warn">Due within 30 days</Badge> : state === "ok" ? <Badge tone="ok">In date</Badge> : <Badge tone="neutral">Never tested</Badge>}
          {canTest && !disposed && <LinkButton href={`/assets/safety-tests/new?assetId=${assetId}`} variant="ghost">Record a test</LinkButton>}
        </>}>
        {tests.length === 0 ? <p className="p-5 text-sm text-muted">No electrical safety test on record.</p> : (
          <ul className="divide-y divide-line">
            {tests.map((t) => (
              <li key={t.id} id={`safety-tests-${t.id}`} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={t.result === "PASS" ? "ok" : "danger"}>{t.result === "PASS" ? "Passed" : "Failed"}</Badge>
                  <b>{formatDate(t.testedOn)}</b><span className="text-muted">by {t.testedByName ?? "someone"}</span>
                  {t.nextDue && <span className="ml-auto text-muted">next due {formatDate(t.nextDue)}</span>}
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {CLASS_LABELS[t.protectionClass]} · {APPLIED_PART_LABELS[t.appliedPart]}
                  {t.earthResistanceOhm != null && <> · earth {t.earthResistanceOhm} Ω</>}{t.insulationMOhm != null && <> · insulation {t.insulationMOhm} MΩ</>}
                  {t.equipmentLeakageUa != null && <> · equipment leakage {t.equipmentLeakageUa} µA</>}{t.appliedPartLeakageUa != null && <> · applied part leakage {t.appliedPartLeakageUa} µA</>}
                </p>
                {t.failures.length > 0 && <p className="mt-1 text-[13px] font-semibold text-danger">{t.failures.join(" ")}</p>}
                <p className="mt-1 text-xs text-muted">Analyser: {t.analyserLabel ?? "not recorded"}{t.analyserCalibrationDue ? `, calibration to ${formatDate(t.analyserCalibrationDue)}` : ""}{t.notes ? ` · ${t.notes}` : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Incidents" padded={false}
        actions={canReport && !disposed ? <LinkButton href={`/assets/incidents/new?assetId=${assetId}`} variant="ghost">Report an incident</LinkButton> : undefined}>
        {incs.length === 0 ? <p className="p-5 text-sm text-muted">No incident on record for this device.</p> : (
          <ul className="divide-y divide-line">
            {incs.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                <Link href={`/assets/incidents/${i.id}`} className="font-semibold text-primary hover:underline">{i.number}</Link>
                <span className="min-w-0 flex-1">{i.title}</span>
                <Badge tone={HARM_TONE[i.harm]}>{HARM_LABELS[i.harm].split(":")[0]}</Badge>
                <Badge tone={i.status === "CLOSED" ? "ok" : "warn"}>{INCIDENT_STATUS_LABELS[i.status]}</Badge>
                <span className="text-muted">{formatDate(i.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** The switch that makes a device test equipment, with its calibration date (wave 23). */
export function TestEquipmentForm({ asset }: { asset: { id: number; isTestEquipment: boolean; calibrationDue: string | null; calibrationCertRef: string | null } }) {
  const today = todayISO();
  return (
    <Panel title="Test equipment" actions={asset.isTestEquipment ? (!asset.calibrationDue || asset.calibrationDue < today ? <Badge tone="danger">Calibration run out</Badge> : <Badge tone="ok">Calibration in date</Badge>) : undefined}>
      <ActionForm action={setTestEquipmentAction} className="space-y-3">
        <input type="hidden" name="assetId" value={asset.id} />
        <label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="isTestEquipment" className="size-5" defaultChecked={asset.isTestEquipment} /> This is a tester or analyser used to check other devices</label>
        <FormGrid cols={2}>
          <Field label="Calibration runs out on"><Input type="date" name="calibrationDue" defaultValue={asset.calibrationDue ?? ""} /></Field>
          <Field label="Certificate number"><Input name="calibrationCertRef" defaultValue={asset.calibrationCertRef ?? ""} maxLength={120} /></Field>
        </FormGrid>
        <p className="text-xs text-muted">A safety test can&apos;t be recorded with an analyser whose calibration has run out.</p>
        <SubmitButton variant="secondary">Save</SubmitButton>
      </ActionForm>
    </Panel>
  );
}
