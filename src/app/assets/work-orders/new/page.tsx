import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, rooms, workOrders } from "@/db/schema";
import { Button, Field, Input, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { enumOptions, NativeSelect } from "@/components/assets/bits";
import { maintenanceTypeLabel } from "@/lib/assets/maintenance";
import { ACTIVE_STATUSES, RESPONSE_HOURS, WORK_ORDER_PRIORITIES, WORK_ORDER_TYPES } from "@/lib/assets/work-orders";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatHours } from "@/lib/assets/work-orders";
import { reportFaultAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report a fault" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ assetId?: string; tag?: string }> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const canReport = can(me.role, "workorders.report"), canWork = can(me.role, "maintenance.edit");
  const assetId = /^\d+$/.test(sp.assetId ?? "") ? Number(sp.assetId) : undefined;
  const tag = sp.tag?.trim().toUpperCase().slice(0, 48);

  const [a] = assetId || tag ? await db.select({
    id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, criticality: assets.criticality,
    manufacturer: assets.manufacturer, model: assets.model, typeName: deviceTypes.name, roomCode: rooms.code, roomName: rooms.name, departmentName: departments.name,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
    .leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(assetId ? eq(assets.id, assetId) : sql`upper(${assets.assetTag}) = ${tag}`) : [];
  if (a) await requireFacilityAccess(a.facilityId, me);
  const open = a ? await db.select({ id: workOrders.id, number: workOrders.number, title: workOrders.title, status: workOrders.status }).from(workOrders)
    .where(and(eq(workOrders.assetId, a.id), inArray(workOrders.status, [...ACTIVE_STATUSES]))) : [];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Report a fault" back={a ? { href: `/assets/${a.id}`, label: a.tag } : { href: "/assets/work-orders", label: "Work orders" }}
        description="Tell the biomedical team what is wrong. They are notified straight away." />
      {!canReport ? <p className="text-sm text-muted">Your account can&apos;t report faults. Ask an administrator.</p> : (
        <>
          {a && open.length > 0 && (
            <Panel title="Already reported" className="mb-4">
              <p className="mb-2 text-sm text-muted">This device already has an open job. Add to it instead of reporting twice if it&apos;s the same problem.</p>
              <ul className="space-y-1 text-sm">
                {open.map((w) => <li key={w.id}><Link href={`/assets/work-orders/${w.id}`} className="font-semibold text-primary hover:underline">{w.number}</Link> {w.title} <StatusBadge value={w.status} /></li>)}
              </ul>
            </Panel>
          )}
          <Panel>
            <ActionForm action={reportFaultAction} className="space-y-4">
              {a ? (
                <div className="rounded-[var(--radius-control)] border border-line bg-sunken px-3 py-2 text-sm">
                  <input type="hidden" name="assetId" value={a.id} />
                  <p className="font-semibold">{a.tag} · {a.typeName}</p>
                  <p className="text-muted">{[a.manufacturer, a.model].filter(Boolean).join(" ") || "Make and model not recorded"}</p>
                  <p className="text-muted">{[a.departmentName, a.roomName && `${a.roomName} (${a.roomCode})`].filter(Boolean).join(" · ") || "No location"}</p>
                </div>
              ) : (
                <Field label="Asset tag" hint="Printed on the device's label, e.g. LPH-MON-000042.">
                  <Input name="assetTag" required defaultValue={tag} autoCapitalize="characters" autoComplete="off" placeholder="LPH-MON-000042" />
                </Field>
              )}
              {tag && !a && <p role="alert" className="text-sm text-danger">No device has the tag {tag}. Check the label.</p>}
              <Field label="What is wrong?"><Input name="title" required maxLength={160} placeholder="e.g. Screen stays black, alarm sounding, cracked cable" /></Field>
              <Field label="Details" hint="When it started, error codes on screen, anything you already tried."><Textarea name="description" rows={4} /></Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="deviceDown" className="mt-1" defaultChecked />
                <span><span className="font-semibold">The device can&apos;t be used</span><br /><span className="text-muted">It is taken out of service until the job is done, and the time counts as downtime.</span></span>
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Priority" hint="Leave blank to set it from how critical the device is.">
                  <NativeSelect name="priority" placeholder="Set automatically"
                    options={WORK_ORDER_PRIORITIES.map((p) => ({ value: p, label: `${enumOptions([p])[0].label} — respond within ${formatHours(RESPONSE_HOURS[p])}` }))} />
                </Field>
                {canWork && (
                  <Field label="Job type"><NativeSelect name="type" value="CORRECTIVE" options={WORK_ORDER_TYPES.map((t) => ({ value: t, label: maintenanceTypeLabel(t) }))} /></Field>
                )}
                <Field label="How to reach you" hint="Extension or mobile, optional."><Input name="reporterContact" maxLength={120} inputMode="tel" /></Field>
              </div>
              <Button>Report fault</Button>
            </ActionForm>
          </Panel>
        </>
      )}
    </div>
  );
}
