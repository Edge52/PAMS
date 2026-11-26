import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { competencies, competencyOverrides, deviceTypes, workOrders, assets } from "@/db/schema";
import { Badge, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Stat, Table, Td, Th, THead, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { SubmitButton } from "@/components/ui/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { categoryOptions, deviceTypeOptions } from "@/lib/assets/queries";
import { assignableUsers, assignableUsersAll } from "@/lib/assets/work-order-server";
import {
  COMPETENCY_STATE_LABELS, COMPETENCY_TONE, COMPETENCY_WARN_DAYS, expiringRecords, recordState, TRAINING_KIND_LABELS, TRAINING_KINDS, type TrainingKind,
} from "@/lib/assets/competency";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatNumber, todayISO } from "@/lib/format";
import { saveCompetencyAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Technician competency" };

const MAX_COLUMNS = 30;

/**
 * Technician competency (wave 40, GAHAR EFS.10 EOC 2–3): engineers and technicians against the device types and
 * categories they are trained on, with the authorisation to service each, expiry dates and overrides.
 */
export default async function CompetencyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const userFilter = Number(one("userId")) || undefined;
  const today = todayISO();
  const canEdit = can(me.role, "workorders.assign");
  const people = [...new Map((await Promise.all((scope ?? [null]).map((f) => (f === null ? assignableUsersAll() : assignableUsers(f))))).flat().map((u) => [u.id, u])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const shownPeople = userFilter ? people.filter((p) => p.id === userFilter) : people;
  const ids = shownPeople.map((p) => p.id);
  const [records, overrides, types, cats] = await Promise.all([
    ids.length ? db.select({ c: competencies, typeName: deviceTypes.name, typeCode: deviceTypes.code, level: deviceTypes.level }).from(competencies)
      .innerJoin(deviceTypes, eq(deviceTypes.id, competencies.deviceTypeId)).where(and(inArray(competencies.userId, ids), eq(competencies.active, true)))
      .orderBy(deviceTypes.code).limit(3000) : Promise.resolve([]),
    db.select({ o: competencyOverrides, woNumber: workOrders.number, tag: assets.assetTag }).from(competencyOverrides)
      .leftJoin(workOrders, eq(workOrders.id, competencyOverrides.workOrderId)).innerJoin(assets, eq(assets.id, competencyOverrides.assetId))
      .where(scopeWhere(competencyOverrides.facilityId, scope)).orderBy(desc(competencyOverrides.at)).limit(50),
    canEdit ? deviceTypeOptions() : Promise.resolve([]),
    canEdit ? categoryOptions() : Promise.resolve([]),
  ]);
  const catIds = canEdit && cats.length ? await db.select({ id: deviceTypes.id, code: deviceTypes.code }).from(deviceTypes).where(inArray(deviceTypes.code, cats.map((c) => c.code))) : [];
  const catId = new Map(catIds.map((c) => [c.code, c.id]));

  // Columns: every type or category someone shown has a record on.
  const colMap = new Map<number, { id: number; name: string; code: string; level: number }>();
  for (const r of records) colMap.set(r.c.deviceTypeId, { id: r.c.deviceTypeId, name: r.typeName, code: r.typeCode, level: r.level });
  const cols = [...colMap.values()].sort((a, b) => a.code.localeCompare(b.code)).slice(0, MAX_COLUMNS);
  const cell = (userId: number, typeId: number) => {
    const mine = records.filter((r) => r.c.userId === userId && r.c.deviceTypeId === typeId);
    if (!mine.length) return null;
    const best = mine.map((r) => ({ r, s: recordState(r.c, today) })).sort((a, b) => (["authorised", "expiring", "trained", "expired"].indexOf(a.s) - ["authorised", "expiring", "trained", "expired"].indexOf(b.s)))[0];
    return best;
  };
  const due = expiringRecords(records.map((r) => r.c), today);
  const authorisedCount = records.filter((r) => { const s = recordState(r.c, today); return s === "authorised" || s === "expiring"; }).length;
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader title="Technician competency" description="Who is trained on which device types, and who is authorised to service them (GAHAR EFS.10). A record on a category covers every type in it. Giving a job to someone not authorised shows a warning and is recorded below." />
      <Notice sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Engineers and technicians" value={formatNumber(people.length)} />
        <Stat label="Authorisations in date" value={formatNumber(authorisedCount)} />
        <Stat label={`Running out within ${COMPETENCY_WARN_DAYS} days or expired`} value={formatNumber(due.length)} />
        <Stat label="Overrides recorded" value={formatNumber(overrides.length)} hint="Latest 50" />
      </div>
      {people.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <label><span className="sr-only">Person</span><NativeSelect name="userId" aria-label="Person" value={userFilter} placeholder="Everyone" options={people.map((p) => ({ value: p.id, label: p.name }))} /></label>
          <button className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm">Show</button>
        </form>
      )}
      {cols.length === 0 ? (
        <EmptyState title="No training records yet">Record each engineer&apos;s and technician&apos;s training below: the maker&apos;s course, in-house training or on the job, and tick &quot;Authorised to service&quot; when they may work on that type alone.</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Person</Th>{cols.map((c) => <Th key={c.id}><span className="block max-w-32 text-xs">{c.name}</span><span className="font-mono text-[11px] text-muted">{c.code}{c.level < 3 ? " (all)" : ""}</span></Th>)}</tr></THead>
          <tbody>{shownPeople.map((p) => (
            <tr key={p.id}>
              <Td className="whitespace-nowrap"><b>{p.name}</b><span className="block text-xs text-muted">{p.jobTitle ?? p.role}</span></Td>
              {cols.map((c) => {
                const x = cell(p.id, c.id);
                return <Td key={c.id}>{x ? <Link href={`/assets/competency/${x.r.c.id}`} className="hover:underline"><Badge tone={COMPETENCY_TONE[x.s]}>{COMPETENCY_STATE_LABELS[x.s]}</Badge>{x.r.c.expiresOn && <span className="block text-[11px] text-muted">to {formatDate(x.r.c.expiresOn)}</span>}</Link> : <span className="text-muted">—</span>}</Td>;
              })}
            </tr>
          ))}</tbody>
        </Table>
      )}
      {colMap.size > MAX_COLUMNS && <p className="mt-2 text-sm text-warn">Showing the first {MAX_COLUMNS} types. Choose one person to see all of theirs.</p>}

      {due.length > 0 && (
        <Panel title="Running out" className="mt-6">
          <ul className="space-y-1 text-sm">{due.map(({ record, expired }) => {
            const r = records.find((x) => x.c.id === record.id)!;
            return <li key={record.id}><Link href={`/assets/competency/${record.id}`} className="text-primary hover:underline">{nameOf.get(record.userId)} — {r.typeName}</Link> <Badge tone={expired ? "danger" : "warn"}>{expired ? "Expired" : "Expires"} {formatDate(record.expiresOn)}</Badge></li>;
          })}</ul>
        </Panel>
      )}

      <Panel title="Overrides" className="mt-6" padded={false}>
        {overrides.length === 0 ? <p className="p-4 text-sm text-muted">No job has been given to someone without the authorisation.</p> : (
          <Table>
            <THead><tr><Th>When</Th><Th>Job</Th><Th>Given to</Th><Th>Why it warned</Th><Th>By</Th></tr></THead>
            <tbody>{overrides.map(({ o, woNumber, tag }) => (
              <tr key={o.id}>
                <Td className="whitespace-nowrap">{formatDateTime(o.at)}</Td>
                <Td>{o.workOrderId ? <Link href={`/assets/work-orders/${o.workOrderId}`} className="font-mono text-sm text-primary hover:underline">{woNumber}</Link> : "—"}<span className="block font-mono text-xs text-muted">{tag}</span></Td>
                <Td>{o.userName}</Td>
                <Td className="text-sm">{o.problem === "none" ? "No training record" : o.problem === "expired" ? "Training expired" : "Trained, not authorised"}{o.reason && <span className="block text-xs text-muted">{o.reason}</span>}</Td>
                <Td>{o.byName}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>

      {canEdit && people.length > 0 && (
        <Panel title="Record training" className="mt-6">
          <ActionForm action={saveCompetencyAction} className="space-y-3">
            <FormGrid cols={2}>
              <Field label="Person"><NativeSelect name="userId" required value={userFilter} placeholder="Choose a person…" options={people.map((p) => ({ value: p.id, label: p.name }))} /></Field>
              <Field label="Device type or category" hint="A category covers every type in it.">
                <select name="deviceTypeId" required defaultValue="" className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm">
                  <option value="">Choose…</option>
                  <optgroup label="Categories (all types in them)">{cats.filter((c) => catId.has(c.code)).map((c) => <option key={c.code} value={catId.get(c.code)}>{c.level === 1 ? "" : "— "}{c.name} ({c.code})</option>)}</optgroup>
                  <optgroup label="Device types">{types.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.code}</option>)}</optgroup>
                </select>
              </Field>
              <Field label="Training"><NativeSelect name="kind" value="MAKER" options={TRAINING_KINDS.map((k: TrainingKind) => ({ value: k, label: TRAINING_KIND_LABELS[k] }))} /></Field>
              <Field label="Trained on"><Input type="date" name="trainedOn" required max={today} /></Field>
              <Field label="Expires on" hint="Leave blank if it doesn't expire."><Input type="date" name="expiresOn" /></Field>
              <Field label="Trainer or course"><Input name="trainer" maxLength={160} placeholder="e.g. Siemens service school, Cairo" /></Field>
              <Field label="Certificate number"><Input name="certificateRef" maxLength={120} /></Field>
            </FormGrid>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="authorised" className="size-5" /> Authorised to service this type alone</label>
            <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
            <SubmitButton variant="secondary">Save training</SubmitButton>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
