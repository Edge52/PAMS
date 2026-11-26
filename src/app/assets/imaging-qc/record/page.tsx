import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, imagingQcTemplates } from "@/db/schema";
import { Badge, Field, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { SubmitButton } from "@/components/ui/action-form";
import { FREQUENCY_LABELS, limitText, modalityOf, type Frequency } from "@/lib/assets/imaging-qc";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { recordQcRunAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record imaging QC" };

/** A technologist's QC run on one scanner with one template (wave 40). Phone friendly, no client JS needed. */
export default async function RecordQcPage({ searchParams }: { searchParams: Promise<{ assetId?: string; templateId?: string }> }) {
  const me = await requirePermission("workorders.report");
  const sp = await searchParams;
  const assetId = Number(sp.assetId), templateId = Number(sp.templateId);
  if (!Number.isInteger(assetId) || assetId <= 0 || !Number.isInteger(templateId) || templateId <= 0) notFound();
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, typeName: deviceTypes.name, code: deviceTypes.code, model: assets.model })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId));
  if (!a) notFound();
  await requireFacilityAccess(a.facilityId, me);
  const [t] = await db.select().from(imagingQcTemplates).where(eq(imagingQcTemplates.id, templateId));
  if (!t || t.facilityId !== a.facilityId || t.modality !== modalityOf(a.code)) notFound();
  const today = todayISO();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: `/assets/imaging-qc?facilityId=${a.facilityId}`, label: "Imaging QC" }} title={t.name}
        description={<>{FREQUENCY_LABELS[t.frequency as Frequency]} QC on <b className="font-mono">{a.tag}</b> ({a.typeName}{a.model ? `, ${a.model}` : ""}).{t.isExample && <> <Badge tone="warn">Example template</Badge></>}</>} />
      <Panel>
        <ActionForm action={recordQcRunAction} className="space-y-4">
          <input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="templateId" value={t.id} />
          <Field label="Date"><Input type="date" name="performedOn" required defaultValue={today} max={today} /></Field>
          <ol className="space-y-3">{t.items.map((it, i) => (
            <li key={i} className="rounded-[var(--radius-control)] border border-line p-3">
              <p className="text-sm font-semibold">{it.label}</p>
              <p className="text-xs text-muted">{limitText(it)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                {it.kind === "VALUE" ? (
                  <label className="flex items-center gap-2">Value<input name={`v_${i}`} inputMode="decimal" aria-label={`${it.label} value`} className="w-28 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1" />{it.unit && <span className="text-muted">{it.unit}</span>}</label>
                ) : (
                  <>
                    <label className="flex items-center gap-1"><input type="radio" name={`r_${i}`} value="PASS" className="size-5" /> Pass</label>
                    <label className="flex items-center gap-1"><input type="radio" name={`r_${i}`} value="FAIL" className="size-5" /> Fail</label>
                  </>
                )}
                <label className="flex items-center gap-1"><input type="radio" name={`r_${i}`} value="NA" className="size-5" /> Not applicable</label>
                <input name={`n_${i}`} placeholder="Note" aria-label={`${it.label} note`} maxLength={500} className="min-w-40 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1" />
              </div>
            </li>
          ))}</ol>
          <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
          <SubmitButton pendingLabel="Saving…">Save QC run</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
