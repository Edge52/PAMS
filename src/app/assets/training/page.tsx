import Link from "next/link";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, deviceTypes, facilities, trainingSessions } from "@/db/schema";
import { Badge, Button, EmptyState, LinkButton, PageHeader, Stat, Table, Td, Th, THead } from "@/components/ui";
import { SortTh } from "@/components/ui/sort-th";
import { AutoSubmit } from "@/components/auto-submit";
import { DeviceTypeSelect, NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { TRAINING_KIND_LABELS } from "@/lib/assets/training";
import { trainingValidMonths } from "@/lib/assets/training-server";
import { refreshDue } from "@/lib/assets/training";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { parseSort, sortRows } from "@/lib/list";

export const dynamic = "force-dynamic";
export const metadata = { title: "User training" };

/** User training sessions (wave 27): who was trained on which device type, when, and by whom. */
export default async function TrainingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const facilityId = scopedFacilityId(scope, Number(one("facilityId")) || undefined);
  const typeId = Number(one("deviceTypeId")) || undefined;
  const today = todayISO();
  const [facs, months, list, typesUsed] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)),
    trainingValidMonths(),
    db.select({
      s: trainingSessions, typeName: deviceTypes.name, typeCode: deviceTypes.code, department: departments.name, facility: facilities.code,
      attendees: sql<number>`(select count(*) from training_attendees a where a.session_id = ${trainingSessions.id})::int`,
      sheets: sql<number>`(select count(*) from documents d where d.entity_type = 'training' and d.entity_id = ${trainingSessions.id})::int`,
    }).from(trainingSessions).innerJoin(deviceTypes, eq(deviceTypes.id, trainingSessions.deviceTypeId)).innerJoin(facilities, eq(facilities.id, trainingSessions.facilityId))
      .leftJoin(departments, eq(departments.id, trainingSessions.departmentId))
      .where(and(scopeWhere(trainingSessions.facilityId, scope), facilityId ? eq(trainingSessions.facilityId, facilityId) : undefined, typeId ? eq(trainingSessions.deviceTypeId, typeId) : undefined))
      .orderBy(desc(trainingSessions.heldOn), desc(trainingSessions.id)).limit(500),
    db.selectDistinct({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name }).from(trainingSessions).innerJoin(deviceTypes, eq(deviceTypes.id, trainingSessions.deviceTypeId))
      .where(scopeWhere(trainingSessions.facilityId, scope)).orderBy(asc(deviceTypes.name)),
  ]);
  const sort = parseSort(sp, ["date", "type", "trainer", "people"] as const);
  const rows = sortRows(list, sort, { date: (r) => r.s.heldOn, type: (r) => r.typeName, trainer: (r) => r.s.trainer, people: (r) => r.attendees });
  const canEdit = can(me.role, "maintenance.edit");
  const people = list.reduce((n, r) => n + r.attendees, 0);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return (
    <>
      <PageHeader title="User training" description={`Training sessions for the people who use each kind of device. Training older than ${months} months shows as due again on the department page.`}
        actions={canEdit ? <LinkButton href={`/assets/training/new${facilityId ? `?facilityId=${facilityId}` : ""}`} variant="primary">Record training</LinkButton> : undefined} />
      <Notice sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Sessions" value={formatNumber(list.length)} />
        <Stat label="Places taken" value={formatNumber(people)} hint="One person at one session" />
        <Stat label="Sessions in the last 12 months" value={formatNumber(list.filter((r) => r.s.heldOn >= yearAgo).length)} />
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <AutoSubmit />
        {facs.length > 1 && <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} placeholder="All hospitals" options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>}
        <label className="min-w-[14rem]"><span className="sr-only">Device type</span>
          <DeviceTypeSelect types={typesUsed.map((t) => ({ ...t, groupName: null, categoryName: "Trained on", categoryCode: null }))} value={typeId} placeholder="All device types" label="Device type" /></label>
        <Button variant="secondary">Filter</Button>
        {(facilityId || typeId) && <Link href="/assets/training" className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No training recorded" action={canEdit ? <LinkButton href="/assets/training/new">Record training</LinkButton> : undefined}>
          Record each session: the device type, the trainer, who attended, and the signed sheet.
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><SortTh k="date">Date</SortTh><SortTh k="type">Device type</SortTh><Th>Kind</Th><SortTh k="trainer">Trainer</SortTh><Th className="hidden md:table-cell">Department</Th><SortTh k="people">Attended</SortTh><Th className="hidden md:table-cell">Sign-in sheet</Th></tr></THead>
          <tbody>
            {rows.map(({ s, typeName, department, facility, attendees, sheets }) => (
              <tr key={s.id}>
                <Td className="whitespace-nowrap"><Link href={`/assets/training/${s.id}`} className="font-semibold text-primary hover:underline">{formatDate(s.heldOn)}</Link>
                  {refreshDue(s.heldOn, months) < today && <span className="block text-xs text-muted">Older than {months} months</span>}</Td>
                <Td>{typeName}<span className="block text-xs text-muted">{facility}</span></Td>
                <Td>{TRAINING_KIND_LABELS[s.kind]}</Td>
                <Td>{s.trainer}</Td>
                <Td className="hidden md:table-cell">{department ?? "—"}</Td>
                <Td>{attendees}</Td>
                <Td className="hidden md:table-cell">{sheets ? <Badge tone="ok">Attached</Badge> : <Badge tone="warn">Missing</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
