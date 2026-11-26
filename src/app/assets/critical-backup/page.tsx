import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, facilities } from "@/db/schema";
import { Badge, Button, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Stat, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { AutoSubmit } from "@/components/auto-submit";
import { DeviceTypeSelect, NativeSelect } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { backupRows } from "@/lib/compliance/critical-backup-server";
import { CRITICAL_LEVELS, shortfalls } from "@/lib/compliance/critical-backup";
import { humanize } from "@/lib/status";
import { deleteCriticalBackupAction, saveCriticalBackupAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backups for critical devices" };

/** Backups for critical devices (wave 40): how many each department must keep, and where it falls short today. */
export default async function CriticalBackupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || null) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Backups for critical devices" /><EmptyState title="No hospital to show">You don&apos;t have access to any hospital yet.</EmptyState></>;
  await requireFacilityAccess(facilityId, me);
  const canEdit = can(me.role, "assets.edit");
  const [rows, depts, types] = await Promise.all([
    backupRows(scope, facilityId),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name)),
    canEdit ? deviceTypeOptions() : Promise.resolve([]),
  ]);
  const short = shortfalls(rows);
  const noneLeft = short.filter((r) => r.state === "none_left").length;
  const sorted = rows.toSorted((a, b) => a.departmentName.localeCompare(b.departmentName) || a.typeName.localeCompare(b.typeName));

  return (
    <>
      <PageHeader title="Backups for critical devices"
        description="Set how many units each department needs working: the ones in daily use plus the backups. Working means installed or in service. Biomedical engineers are told when the last working backup of a life-support or high criticality type goes." />
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Settings" value={rows.length} />
        <Stat label="Short of working units" value={short.length} hint="Life-support and high criticality types" />
        <Stat label="No backup left" value={noneLeft} />
      </div>

      <Panel title="Shortfall" padded={false}>
        {short.length === 0 ? <p className="p-4 text-sm text-muted">{rows.length ? "Every life-support and high criticality setting has enough working units." : "No backup settings yet. Add one below."}</p> : (
          <Table className="rounded-none border-0">
            <THead><tr><Th>Department</Th><Th>Device type</Th><Th align="right">Working</Th><Th align="right">Needed</Th><Th align="right">Short</Th><Th>State</Th></tr></THead>
            <tbody>{short.map((r) => (
              <tr key={r.id}>
                <Td>{r.departmentName}</Td>
                <Td><Link href={`/assets?departmentId=${r.departmentId}&deviceType=${r.typeCode}`} className="text-primary hover:underline">{r.typeName}</Link>
                  <span className="block text-xs text-muted">{humanize(r.criticality ?? "")} criticality</span></Td>
                <Td align="right">{r.working} of {r.units}</Td>
                <Td align="right">{r.required}</Td>
                <Td align="right" className="font-semibold text-danger">{r.short}</Td>
                <Td>{r.state === "none_left" ? <Badge tone="danger">No backup left</Badge> : <Badge tone="warn">Short</Badge>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>

      <div className="mt-6">
        <Panel title="All settings" padded={false}>
          {sorted.length === 0 ? <p className="p-4 text-sm text-muted">Nothing set for this hospital.</p> : (
            <Table className="rounded-none border-0">
              <THead><tr><Th>Department</Th><Th>Device type</Th><Th align="right">In use</Th><Th align="right">Backups</Th><Th align="right">Working now</Th><Th>Notes</Th>{canEdit && <Th />}</tr></THead>
              <tbody>{sorted.map((r) => (
                <tr key={r.id}>
                  <Td>{r.departmentName}</Td>
                  <Td>{r.typeName}{r.criticality && CRITICAL_LEVELS.has(r.criticality) && <> <Badge tone={r.criticality === "LIFE_SUPPORT" ? "danger" : "warn"}>{humanize(r.criticality)}</Badge></>}</Td>
                  <Td align="right">{r.inUseCount}</Td>
                  <Td align="right">{r.backupCount}</Td>
                  <Td align="right" className={r.short ? "font-semibold text-danger" : undefined}>{r.working}</Td>
                  <Td className="max-w-xs text-sm text-muted">{r.notes ?? ""}</Td>
                  {canEdit && <Td><ActionForm action={deleteCriticalBackupAction} confirm={`Remove the backup setting for ${r.typeName} in ${r.departmentName}?`}>
                    <input type="hidden" name="id" value={r.id} /><SubmitButton variant="ghost">Remove</SubmitButton></ActionForm></Td>}
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Panel>
      </div>

      {canEdit && (
        <div className="mt-6 max-w-3xl">
          <Panel title="Add or change a setting">
            {depts.length === 0 ? <p className="text-sm text-muted">This hospital has no departments yet. Add them under Facilities.</p> : (
              <ActionForm action={saveCriticalBackupAction} className="space-y-3">
                <FormGrid cols={2}>
                  <Field label="Department"><NativeSelect name="departmentId" required placeholder="Choose a department…" options={depts.map((d) => ({ value: d.id, label: d.name }))} /></Field>
                  <Field label="Device type"><DeviceTypeSelect types={types} required /></Field>
                  <Field label="Units in daily use"><Input type="number" name="inUseCount" min={0} max={500} defaultValue={1} required /></Field>
                  <Field label="Backups needed" hint="Spare working units on top of those in use."><Input type="number" name="backupCount" min={0} max={500} defaultValue={1} required /></Field>
                  <Field label="Notes"><Input name="notes" maxLength={1000} placeholder="e.g. one transport ventilator kept in the store" /></Field>
                </FormGrid>
                <SubmitButton>Save setting</SubmitButton>
                <p className="text-xs text-muted">The same department and device type again changes the existing setting.</p>
              </ActionForm>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
