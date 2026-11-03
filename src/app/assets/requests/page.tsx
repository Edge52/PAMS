import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, equipmentRequests, facilities } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, StatusBadge, TabLinks, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { decideRequestAction, requestsToBoqAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment requests" };
const TABS = [{ key: "SUBMITTED", label: "Waiting" }, { key: "APPROVED", label: "Approved" }, { key: "PLANNED", label: "In a BOQ" }, { key: "REJECTED", label: "Not approved" }] as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Equipment requests" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const rows = await db.select({ r: equipmentRequests, typeName: deviceTypes.name, dept: departments.name, replaces: assets.assetTag }).from(equipmentRequests)
    .innerJoin(deviceTypes, eq(deviceTypes.id, equipmentRequests.deviceTypeId)).leftJoin(departments, eq(departments.id, equipmentRequests.departmentId)).leftJoin(assets, eq(assets.id, equipmentRequests.replacesAssetId))
    .where(and(eq(equipmentRequests.facilityId, facilityId), eq(equipmentRequests.status, tab.key))).orderBy(desc(equipmentRequests.id));
  const canDecide = can(me.role, "boq.approve"), canBoq = can(me.role, "boq.edit");
  const year = new Date().getFullYear();
  const item = (x: typeof rows[number]) => (
    <div className="min-w-0">
      <p><b>{x.r.number}</b> · {x.r.quantity} × {x.typeName} {x.r.priority !== "NORMAL" && <StatusBadge value={x.r.priority} />}</p>
      <p className="text-xs text-muted">{x.dept ?? "Hospital-wide"} · by {x.r.requestedByName ?? "—"}, {formatDate(x.r.createdAt)}{x.r.neededBy ? ` · needed by ${formatDate(x.r.neededBy)}` : ""}{x.replaces ? <> · replaces <Link href={`/assets/${x.r.replacesAssetId}`} className="font-mono text-primary hover:underline">{x.replaces}</Link></> : null}</p>
      <p className="mt-1 whitespace-pre-line">{x.r.reason}</p>
      {x.r.decidedByName && <p className="mt-1 text-xs text-muted">{x.r.status === "REJECTED" ? "Not approved" : `Approved for ${x.r.planYear}`} by {x.r.decidedByName}{x.r.decisionNote ? `: ${x.r.decisionNote}` : ""}</p>}
      {x.r.boqId && <Link href={`/boq/${x.r.boqId}`} className="text-xs text-primary hover:underline">Open the BOQ</Link>}
    </div>
  );
  return (
    <>
      <PageHeader title="Equipment requests" description="Departments ask for new or replacement equipment; the director approves them for a year, which puts them in the capital plan, and approved requests become a BOQ."
        actions={<Link href={`/assets/department?facilityId=${facilityId}`} className="text-sm font-semibold text-primary hover:underline">Request equipment</Link>} />
      <Notice sp={sp} />
      <form className="mb-4 flex flex-wrap items-end gap-2"><input type="hidden" name="tab" value={tab.key} />
        <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field><Button variant="secondary">Show</Button></form>
      <TabLinks active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/assets/requests?facilityId=${facilityId}&tab=${t.key}` }))} />
      {rows.length === 0 ? <EmptyState title="Nothing here">No requests {tab.label.toLowerCase()}.</EmptyState> : tab.key === "APPROVED" ? (
        <ActionForm action={requestsToBoqAction} className="mt-4">
          <Panel padded={false}>
            <ul className="divide-y divide-line text-sm">{rows.map((x) => <li key={x.r.id} className="flex gap-3 px-4 py-3">{canBoq && <input type="checkbox" name="requestIds" value={x.r.id} defaultChecked aria-label={`Include ${x.r.number}`} className="mt-1" />}{item(x)}</li>)}</ul>
          </Panel>
          {canBoq && <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="BOQ name" className="min-w-64 flex-1"><Input name="name" defaultValue={`${facs.find((f) => f.id === facilityId)?.name ?? ""} — department requests ${year}`} maxLength={200} /></Field><Button>Turn the ticked requests into a BOQ</Button></div>}
        </ActionForm>
      ) : (
        <Panel padded={false} className="mt-4">
          <ul className="divide-y divide-line text-sm">{rows.map((x) => (
            <li key={x.r.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_20rem]">
              {item(x)}
              {canDecide && x.r.status === "SUBMITTED" && (
                <ActionForm action={decideRequestAction} className="space-y-2">
                  <input type="hidden" name="requestId" value={x.r.id} />
                  <Field label="Plan for"><NativeSelect name="planYear" value={year} options={[0, 1, 2, 3, 4].map((k) => ({ value: year + k, label: String(year + k) }))} /></Field>
                  <Textarea name="note" rows={2} placeholder="Note (needed to reject)" aria-label="Note" />
                  <div className="flex gap-2"><Button name="decision" value="approve">Approve</Button><Button variant="secondary" name="decision" value="reject">Not approved</Button></div>
                </ActionForm>
              )}
              {x.r.status !== "SUBMITTED" && <div><Badge tone={x.r.status === "REJECTED" ? "danger" : "ok"}>{TABS.find((t) => t.key === x.r.status)?.label}</Badge></div>}
            </li>
          ))}</ul>
        </Panel>
      )}
    </>
  );
}
