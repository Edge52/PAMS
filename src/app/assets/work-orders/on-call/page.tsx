import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Badge, control, EmptyState, Field, Input, PageHeader, Panel, TabLinks } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDateTime, todayISO } from "@/lib/format";
import { onCallList } from "@/lib/assets/fault-escalation-server";
import { assignableUsers } from "@/lib/assets/work-order-server";
import { addOnCallAction, removeOnCallAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "On call" };

export default async function OnCallPage({ searchParams }: { searchParams: Promise<{ facilityId?: string }> }) {
  const me = await requirePermission("workorders.assign");
  const sp = await searchParams;
  const scope = await facilityScope(me);
  const list = await db.select({ id: facilities.id, name: facilities.name }).from(facilities)
    .where(scope ? inArray(facilities.id, scope.length ? scope : [-1]) : undefined).orderBy(asc(facilities.name)).limit(200);
  if (!list.length) return <><PageHeader title="On call" /><EmptyState title="No hospital to show">Ask an administrator for access to a hospital.</EmptyState></>;
  const fid = list.some((f) => String(f.id) === sp.facilityId) ? Number(sp.facilityId) : list[0].id;
  await requireFacilityAccess(fid, me);
  const now = new Date();
  const [rows, people] = await Promise.all([onCallList(fid, now), assignableUsers(fid)]);
  const today = todayISO(now);
  return (
    <>
      <PageHeader back={{ href: "/assets/work-orders", label: "Work orders" }} title="On call"
        description="Who is on duty for faults. When a fault report isn't picked up in time, the people on call now are told again, then the biomedical lead. With nobody on the list, every technician and engineer is told." />
      {list.length > 1 && <TabLinks active={String(fid)} tabs={list.map((f) => ({ key: String(f.id), label: f.name, href: `/assets/work-orders/on-call?facilityId=${f.id}` }))} />}
      <div className="mt-4 space-y-6">
        <Panel title="On the list" padded={false}>
          {rows.length === 0 ? <p className="p-5 text-sm text-muted">Nobody is on the list: every technician and engineer of this hospital is told. Add the people on duty below.</p> : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{r.name} {r.startsAt <= now ? <Badge tone="ok">On call now</Badge> : <Badge tone="info">Later</Badge>}</p>
                    <p className="text-muted">{formatDateTime(r.startsAt)} to {formatDateTime(r.endsAt)}{r.setByName ? ` · added by ${r.setByName}` : ""}</p>
                  </div>
                  <ActionForm action={removeOnCallAction} confirm={`Take ${r.name} off the on-call list?`}>
                    <input type="hidden" name="entryId" value={r.id} />
                    <SubmitButton variant="secondary">Remove</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Add someone">
          {people.length === 0 ? <p className="text-sm text-muted">Nobody here can take jobs yet: give a technician or engineer access to this hospital first.</p> : (
            <ActionForm action={addOnCallAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
              <input type="hidden" name="facilityId" value={fid} />
              <Field label="Person">
                <select name="userId" required defaultValue="" className={`${control} pr-8`}>
                  <option value="" disabled>Choose…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="From (Cairo time)"><Input type="datetime-local" name="startsAt" required defaultValue={`${today}T08:00`} /></Field>
              <Field label="To (Cairo time)"><Input type="datetime-local" name="endsAt" required defaultValue={`${today}T16:00`} /></Field>
              <div><SubmitButton>Add to the list</SubmitButton></div>
            </ActionForm>
          )}
        </Panel>
      </div>
    </>
  );
}
