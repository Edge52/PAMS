import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes } from "@/db/schema";
import { Field, FormGrid, Input, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { inScope } from "@/lib/assets/access";
import { HARM_LABELS, HARMS } from "@/lib/assets/incidents";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { reportIncidentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report an incident" };

export default async function NewIncidentPage({ searchParams }: { searchParams: Promise<{ assetId?: string }> }) {
  const me = await requirePermission("workorders.report");
  const scope = await facilityScope(me);
  const assetId = Number((await searchParams).assetId);
  const [a] = Number.isInteger(assetId) && assetId > 0
    ? await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, typeName: deviceTypes.name }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId))
    : [];
  const device = a && inScope(scope, a.facilityId) ? a : null;
  // Without a device chosen: the user types the tag's number; a short list would not fit a register of thousands.
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Report an incident" back={{ href: "/assets/incidents", label: "Incidents" }}
        description="Say what happened in plain words. If someone was hurt, look after them first, then take the device out of use and keep it as it was found, with its accessories and settings." />
      <Panel>
        <ActionForm action={reportIncidentAction} className="space-y-5">
          {device ? (
            <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-sm"><input type="hidden" name="assetId" value={device.id} />Device: <b className="font-mono">{device.tag}</b> · {device.typeName}</p>
          ) : (
            <Field label="Device number" hint="The number at the end of the device page's address, e.g. 295 for /assets/295. Easier: open the device and press Report an incident there.">
              <Input name="assetId" inputMode="numeric" required placeholder="295" />
            </Field>
          )}
          <Field label="Short title"><Input name="title" required maxLength={160} placeholder="e.g. Infusion pump delivered a bolus without being asked" /></Field>
          <Field label="What happened" hint="What was being done, what the device did, what was seen on its screen, and what was done next."><Textarea name="description" required rows={5} /></Field>
          <FormGrid cols={3}>
            <Field label="Date it happened"><Input type="date" name="occurredOn" required defaultValue={todayISO()} max={todayISO()} /></Field>
            <Field label="Time" hint="If known"><Input type="time" name="occurredTime" /></Field>
            <Field label="Harm"><Select name="harm" defaultValue="NONE" options={HARMS.map((h) => ({ value: h, label: HARM_LABELS[h] }))} /></Field>
          </FormGrid>
          <div className="space-y-2">
            <label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="patientInvolved" className="size-5" /> A patient was connected to or treated with the device</label>
            <label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="deviceQuarantined" className="size-5" defaultChecked /> The device is out of use and kept as found (it will be marked out of service)</label>
          </div>
          <Field label="What was done straight away"><Textarea name="immediateAction" rows={2} placeholder="e.g. Pump swapped, patient checked by Dr …, pump labelled and moved to the biomedical workshop" /></Field>
          <SubmitButton pendingLabel="Recording…">Record the incident</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
