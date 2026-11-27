import Link from "next/link";
import { and, asc, desc, eq, inArray, like, notInArray, or } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, utilityTests, workOrders } from "@/db/schema";
import { Badge, Button, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Stat, TabLinks, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { backupRows } from "@/lib/compliance/critical-backup-server";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import {
  DUE_LABELS, DUE_TONE, everyText, isTestKind, isUtilityKind, KIND_LABELS, kindForTypeCode, PRESSURES, TEST_LABELS, UTILITY_KINDS, UTILITY_TYPE_CODES, type TestKind,
} from "@/lib/utilities/utilities";
import { utilityDue, type SystemRow } from "@/lib/utilities/utilities-server";
import { saveUtilitySystemAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utilities" };

const TABS = ["due", "systems", "tests", "backups"] as const;
const kindOptions = UTILITY_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }));
const pressureOptions = PRESSURES.map((p) => ({ value: p, label: p === "POSITIVE" ? "Positive" : p === "NEGATIVE" ? "Negative" : "Not controlled" }));

/**
 * Utility systems (wave 41, GAHAR EFS.11; ECRI 2026 hazard 2): generators, UPS, transfer switches, medical gas plant
 * and alarms, theatre and isolation air handling, water tanks, chillers, lifts, fire pumps and cold-chain fridges.
 * Each is a device in the register, so its planned maintenance, work orders, documents, QR label and 3D pin work as
 * for any device; this page adds its scheduled tests and results.
 */
export default async function UtilitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.id));
  const facilityId = scopedFacilityId(scope, Number(one("facilityId")) || null) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Utilities" /><EmptyState title="No hospital to show">You don&apos;t have access to any hospital yet.</EmptyState></>;
  await requireFacilityAccess(facilityId, me);
  const tab = TABS.find((t) => t === one("tab")) ?? "due";
  const today = todayISO();
  const canEdit = can(me.role, "assets.edit"), canRecord = can(me.role, "maintenance.edit");
  const { systems, rows } = await utilityDue(scope, facilityId, today);
  const href = (t: string) => `/buildings/utilities?facilityId=${facilityId}&tab=${t}`;
  const late = rows.filter((r) => r.state === "overdue" || r.state === "never").length;
  const recent = tab === "tests" || tab === "due" ? await db.select({ t: utilityTests, tag: assets.assetTag, woNumber: workOrders.number }).from(utilityTests)
    .innerJoin(assets, eq(assets.id, utilityTests.assetId)).leftJoin(workOrders, eq(workOrders.id, utilityTests.workOrderId))
    .where(eq(utilityTests.facilityId, facilityId)).orderBy(desc(utilityTests.testedOn), desc(utilityTests.id)).limit(100) : [];
  const failed30 = recent.filter((r) => !r.t.passed && r.t.testedOn >= new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)).length;

  return (
    <>
      <PageHeader title="Utilities" description="Generators, UPS, medical gas plant and alarms, theatre and isolation air handling, water tanks, lifts, fire pumps and cold-chain fridges (GAHAR EFS.11): their scheduled tests and results. Each system is a device in the register, so its maintenance, work orders, documents and label work as usual. Medical gas purity tests and pipeline certificates stay with the contractor: keep them as documents on the system." />
      <Notice sp={sp} />
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <input type="hidden" name="tab" value={tab} />
          <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Utility systems" value={formatNumber(systems.filter((s) => s.active).length)} hint={`${systems.filter((s) => s.active && s.critical).length} critical`} href={href("systems")} />
        <Stat label="Tests overdue or never done" value={formatNumber(late)} href={href("due")} />
        <Stat label="Tests in date" value={rows.length ? `${Math.round(((rows.length - late) / rows.length) * 100)} %` : "—"} hint={`${rows.length} scheduled tests`} />
        <Stat label="Failed in the last 30 days" value={formatNumber(failed30)} href={href("tests")} />
      </div>
      <TabLinks active={tab} tabs={[
        { key: "due", label: "Due", href: href("due") }, { key: "systems", label: `Systems (${systems.length})`, href: href("systems") },
        { key: "tests", label: "Results", href: href("tests") }, { key: "backups", label: "Backups", href: href("backups") },
      ]} />

      {tab === "due" && (rows.length === 0 ? (
        <EmptyState title="No utility systems yet" action={canEdit ? <LinkButton href={href("systems")}>Add a utility system</LinkButton> : undefined}>Register the generator, UPS, gas plant and other systems as devices, then mark them as utility systems on the Systems tab.</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>System</Th><Th>Test</Th><Th>Last</Th><Th>State</Th>{canRecord && <Th><span className="sr-only">Record</span></Th>}</tr></THead>
          <tbody>{rows.map((r) => (
            <tr key={`${r.system.id}:${r.test}`}>
              <Td><Link href={`/assets/${r.system.assetId}`} className="font-mono text-sm text-primary hover:underline">{r.system.tag}</Link><span className="block text-xs text-muted">{kindLabel(r.system.kind)}{r.system.serves ? ` · ${r.system.serves}` : ""}</span></Td>
              <Td>{TEST_LABELS[r.test]}<span className="block text-xs text-muted">{everyText(r.everyDays)}</span></Td>
              <Td className="whitespace-nowrap">{r.lastOn ? <>{formatDate(r.lastOn)} {r.lastPassed === false && <Badge tone="danger">Failed</Badge>}</> : <span className="text-muted">Never</span>}</Td>
              <Td><Badge tone={DUE_TONE[r.state]}>{DUE_LABELS[r.state]}</Badge>{r.dueOn && r.state !== "ok" && <span className="block text-xs text-muted">Due {formatDate(r.dueOn)}</span>}</Td>
              {canRecord && <Td><LinkButton variant="secondary" href={`/buildings/utilities/record?systemId=${r.system.id}&kind=${r.test}`}>Record</LinkButton></Td>}
            </tr>
          ))}</tbody>
        </Table>
      ))}

      {tab === "systems" && <Systems facilityId={facilityId} systems={systems} canEdit={canEdit} />}

      {tab === "tests" && (recent.length === 0 ? <EmptyState title="No results yet">Record a test from the Due tab.</EmptyState> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>System</Th><Th>Test</Th><Th>Readings</Th><Th>Result</Th><Th>Work order</Th></tr></THead>
          <tbody>{recent.map(({ t, tag, woNumber }) => (
            <tr key={t.id}>
              <Td className="whitespace-nowrap">{formatDate(t.testedOn)}<span className="block text-xs text-muted">{t.byName}</span></Td>
              <Td><Link href={`/assets/${t.assetId}`} className="font-mono text-sm text-primary hover:underline">{tag}</Link></Td>
              <Td className="text-sm">{isTestKind(t.kind) ? TEST_LABELS[t.kind as TestKind] : t.kind}</Td>
              <Td className="text-sm">{readingsText(t)}{t.problems.length > 0 && <ul className="mt-1 text-xs text-danger">{t.problems.map((p) => <li key={p}>{p}</li>)}</ul>}{t.notes && <span className="block text-xs text-muted">{t.notes}</span>}</Td>
              <Td><Badge tone={t.passed ? "ok" : "danger"}>{t.passed ? "Passed" : "Failed"}</Badge></Td>
              <Td>{t.workOrderId ? <Link href={`/assets/work-orders/${t.workOrderId}`} className="font-mono text-sm text-primary hover:underline">{woNumber}</Link> : <span className="text-muted">—</span>}</Td>
            </tr>
          ))}</tbody>
        </Table>
      ))}

      {tab === "backups" && <Backups facilityId={facilityId} scope={scope} />}
    </>
  );
}

const kindLabel = (k: string) => (isUtilityKind(k) ? KIND_LABELS[k] : k);
const r1 = (n: number) => String(Math.round(n * 10) / 10);

function readingsText(t: typeof utilityTests.$inferSelect): string {
  const p: string[] = [];
  if (t.loadKw != null) p.push(`${r1(t.loadKw)} kW`);
  if (t.durationMin != null) p.push(`${r1(t.durationMin)} min`);
  if (t.transferSec != null) p.push(`transfer ${r1(t.transferSec)} s`);
  if (t.fuelPct != null) p.push(`fuel ${r1(t.fuelPct)} %`);
  if (t.autonomyMin != null) p.push(`autonomy ${r1(t.autonomyMin)} min`);
  if (t.tempMin != null && t.tempMax != null) p.push(`${r1(t.tempMin)}–${r1(t.tempMax)} °C`);
  if (t.excursionMin) p.push(`${r1(t.excursionMin)} min out of range`);
  if (t.airChanges != null) p.push(`${r1(t.airChanges)} air changes/h`);
  if (t.pressurePa != null) p.push(`${t.pressurePa > 0 ? "+" : ""}${r1(t.pressurePa)} Pa`);
  if (t.checksOk != null) p.push(t.checksOk ? "checks all right" : "problem found");
  return p.join(", ") || "—";
}

function SystemFields({ s }: { s?: SystemRow }) {
  return (
    <>
      <FormGrid cols={3}>
        <Field label="Kind"><NativeSelect name="kind" value={s?.kind} required options={kindOptions} placeholder="Choose…" /></Field>
        <Field label="Serves" hint="e.g. Theatres 1–4 and ICU"><Input name="serves" defaultValue={s?.serves ?? ""} maxLength={300} /></Field>
        <Field label="Critical" hint="Patients depend on it: missed tests are alerted"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="critical" defaultChecked={s ? s.critical : true} /> Critical system</label></Field>
        <Field label="Generator rating (kW)"><Input name="ratedKw" type="number" step="any" min="0" defaultValue={s?.ratedKw ?? ""} /></Field>
        <Field label="Lowest fuel level (%)" hint="Blank = 50 %"><Input name="minFuelPct" type="number" step="any" min="0" max="100" defaultValue={s?.minFuelPct ?? ""} /></Field>
        <Field label="UPS autonomy needed (minutes)" hint="Blank = 10"><Input name="requiredMinutes" type="number" step="any" min="0" defaultValue={s?.requiredMinutes ?? ""} /></Field>
        <Field label="Fridge range, lowest (°C)" hint="Blank = 2"><Input name="tempLow" type="number" step="any" defaultValue={s?.tempLow ?? ""} /></Field>
        <Field label="Fridge range, highest (°C)" hint="Blank = 8 (6 for blood)"><Input name="tempHigh" type="number" step="any" defaultValue={s?.tempHigh ?? ""} /></Field>
        <Field label="Air changes needed per hour" hint="Theatre 20, isolation 12 (ASHRAE 170)"><Input name="requiredAch" type="number" step="any" min="0" defaultValue={s?.requiredAch ?? ""} /></Field>
        <Field label="Room pressure"><NativeSelect name="pressure" value={s?.pressure} options={pressureOptions} placeholder="Default for the kind" /></Field>
        <Field label="Least pressure difference (Pa)" hint="Blank = 2.5"><Input name="minPressurePa" type="number" step="any" min="0" defaultValue={s?.minPressurePa ?? ""} /></Field>
      </FormGrid>
      <Field label="Notes" className="mt-4"><Textarea name="notes" defaultValue={s?.notes ?? ""} maxLength={2000} /></Field>
    </>
  );
}

async function Systems({ facilityId, systems, canEdit }: { facilityId: number; systems: SystemRow[]; canEdit: boolean }) {
  const taken = systems.map((s) => s.assetId);
  const candidates = canEdit ? await db.select({ id: assets.id, tag: assets.assetTag, typeName: deviceTypes.name, typeCode: deviceTypes.code }).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, facilityId), or(inArray(deviceTypes.code, UTILITY_TYPE_CODES), like(deviceTypes.code, "UTL-%")), taken.length ? notInArray(assets.id, taken) : undefined))
    .orderBy(asc(assets.assetTag)).limit(500) : [];
  return (
    <div className="space-y-5">
      {systems.length > 0 && <p className="text-sm"><Link className="text-primary hover:underline" href={`/assets/3d?facilityId=${facilityId}&label=utilities&assets=${systems.slice(0, 200).map((s) => s.assetId).join(",")}`}>Show these systems in the 3D view</Link></p>}
      {systems.length === 0 ? <EmptyState title="No utility systems yet">Register each generator, UPS, gas plant, alarm panel, air handling unit, tank, lift, fire pump and fridge as a device (catalogue group Utility systems, Medical gases or Cold chain), then mark it here.</EmptyState> : (
        <Table>
          <THead><tr><Th>System</Th><Th>Kind</Th><Th>Where</Th><Th>Figures</Th><Th>State</Th></tr></THead>
          <tbody>{systems.map((s) => (
            <tr key={s.id}>
              <Td><Link href={`/assets/${s.assetId}`} className="font-mono text-sm text-primary hover:underline">{s.tag}</Link><span className="block text-xs text-muted">{s.typeName}</span></Td>
              <Td>{kindLabel(s.kind)}{s.critical && <span className="ml-1"><Badge tone="warn">Critical</Badge></span>}{s.serves && <span className="block text-xs text-muted">Serves {s.serves}</span>}</Td>
              <Td className="text-sm">{[s.departmentName, s.roomName].filter(Boolean).join(" · ") || "—"}<span className="block text-xs"><Link className="text-primary hover:underline" href={`/assets/${s.assetId}`}>Documents and certificates</Link></span></Td>
              <Td className="text-xs text-muted">{figuresText(s)}</Td>
              <Td>{s.active ? <Badge tone="ok">In use</Badge> : <Badge>Not tested</Badge>}
                {canEdit && <details className="mt-2"><summary className="cursor-pointer text-sm text-primary">Edit</summary><ActionForm action={saveUtilitySystemAction} className="mt-3 space-y-3">
                  <input type="hidden" name="id" value={s.id} /><input type="hidden" name="assetId" value={s.assetId} />
                  <SystemFields s={s} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} /> In use (tests scheduled)</label>
                  <Button>Save system</Button>
                </ActionForm></details>}
              </Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {canEdit && (
        <section aria-labelledby="add-system" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 id="add-system" className="mb-3 font-semibold">Add a utility system</h2>
          {candidates.length === 0 ? <p className="text-sm text-muted">No device left to add. Register the system in the <Link className="text-primary hover:underline" href="/assets/new">asset register</Link> first, with a type from Utility systems, Medical gases or Cold chain.</p> : (
            <ActionForm action={saveUtilitySystemAction} className="space-y-3">
              <Field label="Device"><NativeSelect name="assetId" required placeholder="Choose a device…" options={candidates.map((c) => ({ value: c.id, label: `${c.tag} · ${c.typeName}${kindForTypeCode(c.typeCode) ? ` (${KIND_LABELS[kindForTypeCode(c.typeCode)!]})` : ""}` }))} /></Field>
              <SystemFields />
              <p className="text-xs text-muted">Blank figures take the kind&apos;s defaults. Use the hospital&apos;s design figures where you have them.</p>
              <Button>Add system</Button>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}

function figuresText(s: SystemRow): string {
  const p: string[] = [];
  if (s.ratedKw) p.push(`${r1(s.ratedKw)} kW`);
  if (s.minFuelPct != null) p.push(`fuel ≥ ${r1(s.minFuelPct)} %`);
  if (s.requiredMinutes != null) p.push(`autonomy ≥ ${r1(s.requiredMinutes)} min`);
  if (s.tempLow != null && s.tempHigh != null) p.push(`${r1(s.tempLow)}–${r1(s.tempHigh)} °C`);
  if (s.requiredAch != null) p.push(`≥ ${r1(s.requiredAch)} air changes/h`);
  if (s.pressure && s.pressure !== "NONE") p.push(`${s.pressure === "POSITIVE" ? "+" : "−"}${r1(s.minPressurePa ?? 2.5)} Pa`);
  return p.join(", ") || "—";
}

async function Backups({ facilityId, scope }: { facilityId: number; scope: number[] | null }) {
  const all = await backupRows(scope, facilityId);
  const rows = all.filter((r) => UTILITY_TYPE_CODES.includes(r.typeCode) || r.typeCode.startsWith("UTL-"));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Backup for critical systems uses the same settings as <Link className="text-primary hover:underline" href={`/assets/critical-backup?facilityId=${facilityId}`}>Critical backups</Link>: how many units are in use and how many backups must be working, per department and type (for example two generators and one standby). Biomedical is alerted when the last working backup goes.</p>
      {rows.length === 0 ? <EmptyState title="No backup settings for utility systems" action={<LinkButton href={`/assets/critical-backup?facilityId=${facilityId}`}>Set backups</LinkButton>}>Add a setting for generators, UPS or oxygen supply on Critical backups.</EmptyState> : (
        <Table>
          <THead><tr><Th>Department</Th><Th>Type</Th><Th>Working</Th><Th>Needed</Th><Th>State</Th></tr></THead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><Td>{r.departmentName}</Td><Td>{r.typeName}</Td><Td>{r.working}</Td><Td>{r.required}</Td>
              <Td><Badge tone={r.state === "ok" ? "ok" : r.state === "none_left" ? "danger" : "warn"}>{r.state === "ok" ? "Enough" : r.state === "none_left" ? "No backup left" : `${r.short} short`}</Badge></Td></tr>
          ))}</tbody>
        </Table>
      )}
    </div>
  );
}
