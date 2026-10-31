import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, recallAssets, recalls, workOrders } from "@/db/schema";
import { Badge, Button, Details, PageHeader, Panel, Stat, StatusBadge } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Meter, NativeSelect, Notice } from "@/components/assets/bits";
import { RECALL_ACTION_LABELS, recallProgress, type RecallAction } from "@/lib/assets/recalls";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { closeRecallAction, createRecallJobsAction, rematchRecallAction, setRecallDeviceAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recall" };

export default async function RecallPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [row] = await db.select({ r: recalls, typeName: deviceTypes.name, typeCode: deviceTypes.code }).from(recalls)
    .leftJoin(deviceTypes, eq(deviceTypes.id, recalls.deviceTypeId)).where(eq(recalls.id, Number(id)));
  if (!row) notFound();
  const r = row.r;
  const canEdit = can(me.role, "recalls.edit");
  const [devices, activity] = await Promise.all([
    db.select({ ra: recallAssets, tag: assets.assetTag, model: assets.model, serial: assets.serialNumber, assetStatus: assets.status,
      department: departments.name, facility: facilities.name, woNumber: workOrders.number, woStatus: workOrders.status })
      .from(recallAssets).innerJoin(assets, eq(assets.id, recallAssets.assetId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(workOrders, eq(workOrders.id, recallAssets.workOrderId))
      .where(and(eq(recallAssets.recallId, r.id), scope === null ? undefined : scope.length ? inArray(assets.facilityId, scope) : sql`false`))
      .orderBy(sql`case ${recallAssets.status} when 'PENDING' then 0 else 1 end`, asc(assets.assetTag)),
    getActivity("recall", r.id, 30),
  ]);
  const prog = recallProgress(devices.map((d) => d.ra));
  const withoutJob = devices.filter((d) => d.ra.status === "PENDING" && !d.ra.workOrderId).length;
  const multi = scope === null || scope.length > 1;

  return (
    <>
      <PageHeader back={{ href: "/assets/recalls", label: "Recalls" }}
        title={<span className="flex flex-wrap items-center gap-2">{r.number} <StatusBadge value={r.status} />{r.urgent && <Badge tone="danger">Urgent</Badge>}</span>}
        description={r.title} />
      <Notice sp={sp} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devices affected" value={formatNumber(prog.total)} />
        <Stat label="Still pending" value={formatNumber(prog.pending)} hint={withoutJob ? `${withoutJob} without a job` : undefined} />
        <Stat label="Dealt with" value={formatNumber(prog.actioned)} />
        <Stat label="Not affected" value={formatNumber(prog.notAffected)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Notice">
            <Details items={[
              { label: "Required action", value: RECALL_ACTION_LABELS[r.action as RecallAction] },
              { label: "Source", value: r.source },
              { label: "Manufacturer's reference", value: r.reference },
              { label: "Issued", value: formatDate(r.issuedDate) },
              { label: "Complete by", value: formatDate(r.dueDate) },
              { label: "Device type", value: row.typeName ? <Link href={`/catalogue/${row.typeCode}`} className="text-primary hover:underline">{row.typeName}</Link> : "Any" },
              { label: "Manufacturer", value: r.manufacturer },
              { label: "Model contains", value: r.modelPattern },
              { label: "Serial numbers", value: r.serialNumbers?.length ? `${r.serialNumbers.length} listed` : "All serials" },
            ]} />
            {r.description && <p className="mt-4 whitespace-pre-wrap text-sm">{r.description}</p>}
            <div className="mt-4"><Meter pct={prog.pct} tone={prog.pending ? "warn" : "ok"} label="Devices dealt with" /></div>
          </Panel>

          <Panel title={`Affected devices${multi ? "" : " in your hospital"}`} padded={false}>
            {devices.length === 0 ? <p className="p-4 text-sm text-muted">No device in your register matches this notice.{canEdit && r.status === "OPEN" ? " If devices were added since, check the register again." : ""}</p> : (
              <ul className="divide-y divide-line">{devices.map((d) => (
                <li key={d.ra.assetId} className="grid gap-2 px-4 py-2.5 text-sm sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <Link href={`/assets/${d.ra.assetId}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{d.tag}</Link>
                    <span className="text-muted"> {d.model ?? ""} · SN {d.serial ?? "—"} · {d.department ?? "No department"}{multi ? ` · ${d.facility}` : ""}</span>
                    {d.woNumber && <div className="text-xs">Job <Link href={`/assets/work-orders/${d.ra.workOrderId}`} className="text-primary hover:underline">{d.woNumber}</Link> <StatusBadge value={d.woStatus} /></div>}
                    {d.ra.note && <div className="text-xs text-muted">{d.ra.note}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={d.ra.status} />
                    {canEdit && r.status === "OPEN" && (
                      <ActionForm action={setRecallDeviceAction} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="recallId" value={r.id} /><input type="hidden" name="assetId" value={d.ra.assetId} />
                        <NativeSelect name="status" value={d.ra.status} aria-label={`Status for ${d.tag}`} className="w-auto py-1 text-[13px]"
                          options={[{ value: "PENDING", label: "Pending" }, { value: "ACTIONED", label: "Dealt with" }, { value: "NOT_AFFECTED", label: "Not affected" }]} />
                        <input name="note" placeholder="Note" aria-label={`Note for ${d.tag}`} className="w-32 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[13px]" />
                        <button className="text-[13px] text-primary hover:underline">Save</button>
                      </ActionForm>
                    )}
                  </div>
                </li>
              ))}</ul>
            )}
          </Panel>
        </div>
        <aside className="space-y-6">
          {canEdit && r.status === "OPEN" && (
            <>
              {withoutJob > 0 && (
                <Panel title="Raise jobs">
                  <ActionForm action={createRecallJobsAction} className="space-y-3">
                    <input type="hidden" name="recallId" value={r.id} />
                    <p className="text-sm text-muted">One {r.urgent ? "urgent" : "high-priority"} inspection job for each of the {withoutJob} pending devices.{r.action === "REMOVE_FROM_USE" ? " The devices are taken out of service." : ""} Completing a job marks its device dealt with.</p>
                    <Button>Raise {withoutJob} job{withoutJob === 1 ? "" : "s"}</Button>
                  </ActionForm>
                </Panel>
              )}
              <Panel title="Check the register again">
                <ActionForm action={rematchRecallAction} className="space-y-3">
                  <input type="hidden" name="recallId" value={r.id} />
                  <p className="text-sm text-muted">Finds devices registered since the notice was recorded.</p>
                  <Button variant="secondary">Check again</Button>
                </ActionForm>
              </Panel>
              <Panel title="Close the recall">
                <ActionForm action={closeRecallAction} className="space-y-3">
                  <input type="hidden" name="recallId" value={r.id} />
                  <p className="text-sm text-muted">{prog.done ? "Every device is dealt with or not affected." : `Possible once the ${prog.pending} pending device${prog.pending === 1 ? " is" : "s are"} dealt with.`}</p>
                  <Button variant="secondary" disabled={!prog.done}>Close recall</Button>
                </ActionForm>
              </Panel>
            </>
          )}
          {r.status === "CLOSED" && <Panel><p className="text-sm text-muted">Closed {formatDateTime(r.closedAt)}.</p></Panel>}
          <Panel title="History">
            {activity.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
              <ol className="space-y-3">{activity.map((e) => (
                <li key={e.id} className="text-sm"><p>{e.summary}</p><p className="text-xs text-muted">{formatDateTime(e.at)}{e.actor && ` · ${e.actor}`}</p></li>
              ))}</ol>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
