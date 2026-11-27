import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, facilities, floors, buildings, rooms, waterPoints, waterSamples, workOrders } from "@/db/schema";
import { Badge, Button, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Stat, TabLinks, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { QcTrend } from "@/components/assets/qc-trend";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { addDays, DUE_LABELS, DUE_TONE } from "@/lib/utilities/utilities";
import { limitsOf, pointRows, type PointRow } from "@/lib/utilities/utilities-server";
import { isPointKind, ISO_23500_NOTE, isDialysis, LEVEL_LABELS, LEVEL_TONE, MEASURE_INFO, MEASURES, POINT_KINDS, POINT_LABELS, sampleDue, trendLines, trendOf, type Level } from "@/lib/utilities/water";
import { saveWaterPointAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Water quality" };

const TABS = ["due", "samples", "trend", "points"] as const;
const kindOptions = POINT_KINDS.map((k) => ({ value: k, label: POINT_LABELS[k] }));
const kindLabel = (k: string) => (isPointKind(k) ? POINT_LABELS[k] : k);
const levelBadge = (l: string | null) => l ? <Badge tone={LEVEL_TONE[l as Level] ?? "neutral"}>{LEVEL_LABELS[l as Level] ?? l}</Badge> : <span className="text-muted">—</span>;
const val = (n: number | null, unit: string) => (n == null ? null : `${Math.round(n * 1000) / 1000} ${unit}`);

/**
 * Water quality (wave 41, GAHAR EFS.12; ECRI 2026 hazard 10): sampling points for dialysis water (RO outlet, loop,
 * each machine), sterilizer feed water and drinking water tanks; results with action levels and limits; failures to
 * work orders; the trend per point.
 */
export default async function WaterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.id));
  const facilityId = scopedFacilityId(scope, Number(one("facilityId")) || null) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Water quality" /><EmptyState title="No hospital to show">You don&apos;t have access to any hospital yet.</EmptyState></>;
  await requireFacilityAccess(facilityId, me);
  const tab = TABS.find((t) => t === one("tab")) ?? "due";
  const today = todayISO();
  const canEdit = can(me.role, "assets.edit"), canRecord = can(me.role, "maintenance.edit");
  const points = await pointRows(scope, facilityId);
  const active = points.filter((p) => p.active);
  const due = active.map((p) => ({ p, ...sampleDue(p.lastOn, p.everyDays, today) }))
    .sort((a, b) => ["overdue", "never", "due", "soon", "ok"].indexOf(a.state) - ["overdue", "never", "due", "soon", "ok"].indexOf(b.state) || b.daysLate - a.daysLate);
  const late = due.filter((r) => r.state === "overdue" || r.state === "never").length;
  const href = (t: string, extra = "") => `/buildings/water?facilityId=${facilityId}&tab=${t}${extra}`;
  const recent = tab === "samples" || tab === "due" ? await db.select({ s: waterSamples, name: waterPoints.name, kind: waterPoints.kind, woNumber: workOrders.number }).from(waterSamples)
    .innerJoin(waterPoints, eq(waterPoints.id, waterSamples.pointId)).leftJoin(workOrders, eq(workOrders.id, waterSamples.workOrderId))
    .where(eq(waterSamples.facilityId, facilityId)).orderBy(desc(waterSamples.sampledOn), desc(waterSamples.id)).limit(100) : [];
  const notOk = active.filter((p) => p.lastLevel && p.lastLevel !== "OK").length;
  const [year] = await db.select({ n: sql<number>`count(*)::int`, fail: sql<number>`count(*) filter (where ${waterSamples.level} = 'FAIL')::int` }).from(waterSamples)
    .where(and(eq(waterSamples.facilityId, facilityId), gte(waterSamples.sampledOn, addDays(today, -365))));

  return (
    <>
      <PageHeader title="Water quality" description={`Sampling points and results (GAHAR EFS.12): dialysis water at the RO outlet, the loop and each machine; sterilizer feed water; drinking water tanks. Dialysis levels: total viable count limit 100 CFU/mL, action 50; endotoxin limit 0.25 EU/mL, action 0.125 (${ISO_23500_NOTE}). A result over a limit opens a work order and alerts biomedical.`} />
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
        <Stat label="Sampling points" value={formatNumber(active.length)} hint={`${active.filter((p) => isDialysis(p.kind)).length} dialysis`} href={href("points")} />
        <Stat label="Samples overdue or never taken" value={formatNumber(late)} href={href("due")} />
        <Stat label="Last result not within limits" value={formatNumber(notOk)} href={href("due")} />
        <Stat label="Samples in the last year" value={formatNumber(year?.n ?? 0)} hint={`${year?.fail ?? 0} over the limit`} href={href("samples")} />
      </div>
      <TabLinks active={tab} tabs={[
        { key: "due", label: "Due", href: href("due") }, { key: "samples", label: "Results", href: href("samples") },
        { key: "trend", label: "Trend", href: href("trend") }, { key: "points", label: `Points (${points.length})`, href: href("points") },
      ]} />

      {tab === "due" && (due.length === 0 ? (
        <EmptyState title="No sampling points yet" action={canEdit ? <LinkButton href={href("points")}>Add a sampling point</LinkButton> : undefined}>Add the dialysis RO outlet, the loop, each dialysis machine, the sterilizer feed water and each drinking water tank.</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Point</Th><Th>Last sample</Th><Th>Last result</Th><Th>State</Th>{canRecord && <Th><span className="sr-only">Record</span></Th>}</tr></THead>
          <tbody>{due.map(({ p, state, dueOn }) => (
            <tr key={p.id}>
              <Td>{p.name}<span className="block text-xs text-muted">{kindLabel(p.kind)}{p.roomName ? ` · ${p.roomName}` : ""}</span></Td>
              <Td className="whitespace-nowrap">{p.lastOn ? formatDate(p.lastOn) : <span className="text-muted">Never</span>}</Td>
              <Td>{levelBadge(p.lastLevel)}</Td>
              <Td><Badge tone={DUE_TONE[state]}>{DUE_LABELS[state]}</Badge>{dueOn && state !== "ok" && <span className="block text-xs text-muted">Due {formatDate(dueOn)}</span>}</Td>
              {canRecord && <Td><LinkButton variant="secondary" href={`/buildings/water/record?pointId=${p.id}`}>Record</LinkButton></Td>}
            </tr>
          ))}</tbody>
        </Table>
      ))}

      {tab === "samples" && (recent.length === 0 ? <EmptyState title="No results yet">Record a sample from the Due tab.</EmptyState> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>Point</Th><Th>Results</Th><Th>Level</Th><Th>Work order</Th></tr></THead>
          <tbody>{recent.map(({ s, name, kind, woNumber }) => (
            <tr key={s.id}>
              <Td className="whitespace-nowrap">{formatDate(s.sampledOn)}<span className="block text-xs text-muted">{s.lab ?? s.byName}</span></Td>
              <Td>{name}<span className="block text-xs text-muted">{kindLabel(kind)}</span></Td>
              <Td className="text-sm">{[val(s.tvc, "CFU/mL"), val(s.endotoxin, "EU/mL"), s.chlorine != null ? `chlorine ${val(s.chlorine, "mg/L")}` : null, s.freeChlorine != null ? `free chlorine ${val(s.freeChlorine, "mg/L")}` : null,
                s.conductivity != null ? val(s.conductivity, "µS/cm") : null, s.coliforms != null ? `coliforms ${s.coliforms}/100 mL` : null, s.chemistryOk == null ? null : s.chemistryOk ? "chemistry within limits" : "chemistry out"].filter(Boolean).join(", ")}
                {s.problems.length > 0 && <ul className="mt-1 text-xs text-danger">{s.problems.map((p) => <li key={p}>{p}</li>)}</ul>}</Td>
              <Td>{levelBadge(s.level)}</Td>
              <Td>{s.workOrderId ? <Link href={`/assets/work-orders/${s.workOrderId}`} className="font-mono text-sm text-primary hover:underline">{woNumber}</Link> : <span className="text-muted">—</span>}</Td>
            </tr>
          ))}</tbody>
        </Table>
      ))}

      {tab === "trend" && <Trend points={active} pointId={Number(one("pointId")) || (active.find((p) => isDialysis(p.kind)) ?? active[0])?.id} facilityId={facilityId} />}
      {tab === "points" && <Points facilityId={facilityId} points={points} canEdit={canEdit} />}
    </>
  );
}

async function Trend({ points, pointId, facilityId }: { points: PointRow[]; pointId: number | undefined; facilityId: number }) {
  const p = points.find((x) => x.id === pointId);
  if (!p) return <EmptyState title="No sampling points yet">Add a point on the Points tab.</EmptyState>;
  const samples = await db.select({ sampledOn: waterSamples.sampledOn, tvc: waterSamples.tvc, endotoxin: waterSamples.endotoxin, chlorine: waterSamples.chlorine,
    freeChlorine: waterSamples.freeChlorine, conductivity: waterSamples.conductivity, coliforms: waterSamples.coliforms }).from(waterSamples)
    .where(eq(waterSamples.pointId, p.id)).orderBy(desc(waterSamples.sampledOn)).limit(60);
  const l = limitsOf(p);
  const shown = MEASURES.map((m) => ({ m, pts: trendOf(samples, m, l) })).filter((x) => x.pts.length > 0);
  return (
    <div className="space-y-5">
      <form className="flex flex-wrap items-end gap-2">
        <AutoSubmit />
        <input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="tab" value="trend" />
        <label><span className="sr-only">Point</span><NativeSelect name="pointId" aria-label="Point" value={p.id} options={points.map((x) => ({ value: x.id, label: x.name }))} /></label>
        <Button variant="secondary">Show</Button>
      </form>
      {shown.length === 0 ? <p className="text-sm text-muted">No results at this point yet.</p> : shown.map(({ m, pts }) => {
        const lines = trendLines(m, l);
        return <QcTrend key={m} label={`${p.name}: ${MEASURE_INFO[m].label.toLowerCase()}`} unit={MEASURE_INFO[m].unit} min={lines.min} max={lines.max} points={pts} names={m === "tvc" || m === "endotoxin" ? ["action", "limit"] : ["min", "max"]} />;
      })}
      <p className="text-xs text-muted">Dashed lines: action level and limit, or the allowed minimum or maximum. Red points needed action or failed. Last 60 samples.</p>
    </div>
  );
}

async function Points({ facilityId, points, canEdit }: { facilityId: number; points: PointRow[]; canEdit: boolean }) {
  const [devices, roomList] = canEdit ? await Promise.all([
    db.select({ id: assets.id, tag: assets.assetTag }).from(assets).where(and(eq(assets.facilityId, facilityId), inArray(assets.status, ["INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"]))).orderBy(asc(assets.assetTag)).limit(2000),
    db.select({ id: rooms.id, name: rooms.name, code: rooms.code }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
      .where(eq(buildings.facilityId, facilityId)).orderBy(asc(rooms.name)).limit(3000),
  ]) : [[], []];
  const fields = (p?: PointRow) => (
    <>
      <FormGrid cols={3}>
        <Field label="Name"><Input name="name" defaultValue={p?.name ?? ""} required maxLength={160} placeholder="e.g. RO outlet, dialysis unit" /></Field>
        <Field label="Kind"><NativeSelect name="kind" value={p?.kind} required options={kindOptions} placeholder="Choose…" /></Field>
        <Field label="Sample every (days)" hint="Blank = 30 (tanks 91)"><Input name="everyDays" type="number" min="1" max="730" defaultValue={p?.everyDays ?? ""} /></Field>
        <Field label="Plant, machine or tank" hint="A failed result opens a work order on it"><NativeSelect name="assetId" value={p?.assetId} placeholder="None" options={devices.map((d) => ({ value: d.id, label: d.tag }))} /></Field>
        <Field label="Room"><NativeSelect name="roomId" value={p?.roomId} placeholder="None" options={roomList.map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))} /></Field>
      </FormGrid>
      <p className="text-xs text-muted">{p ? "Blank limits mean no limit." : `Blank limits take the defaults for the kind: dialysis ${ISO_23500_NOTE}; drinking water no coliforms and free chlorine at least 0.2 mg/L. Sterilizer feed water has no default: enter the sterilizer maker's or AAMI ST108 limits.`}</p>
      <FormGrid cols={4}>
        <Field label="TVC action (CFU/mL)"><Input name="tvcAction" type="number" step="any" min="0" defaultValue={p?.tvcAction ?? ""} /></Field>
        <Field label="TVC limit (CFU/mL)"><Input name="tvcLimit" type="number" step="any" min="0" defaultValue={p?.tvcLimit ?? ""} /></Field>
        <Field label="Endotoxin action (EU/mL)"><Input name="endotoxinAction" type="number" step="any" min="0" defaultValue={p?.endotoxinAction ?? ""} /></Field>
        <Field label="Endotoxin limit (EU/mL)"><Input name="endotoxinLimit" type="number" step="any" min="0" defaultValue={p?.endotoxinLimit ?? ""} /></Field>
        <Field label="Total chlorine, most (mg/L)"><Input name="chlorineMax" type="number" step="any" min="0" defaultValue={p?.chlorineMax ?? ""} /></Field>
        <Field label="Free chlorine, least (mg/L)"><Input name="freeChlorineMin" type="number" step="any" min="0" defaultValue={p?.freeChlorineMin ?? ""} /></Field>
        <Field label="Conductivity, most (µS/cm)"><Input name="conductivityMax" type="number" step="any" min="0" defaultValue={p?.conductivityMax ?? ""} /></Field>
        <Field label="Coliforms, most (per 100 mL)"><Input name="coliformMax" type="number" step="any" min="0" defaultValue={p?.coliformMax ?? ""} /></Field>
      </FormGrid>
      <Field label="Notes"><Textarea name="notes" defaultValue={p?.notes ?? ""} maxLength={2000} /></Field>
    </>
  );
  return (
    <div className="space-y-5">
      {points.length === 0 ? <EmptyState title="No sampling points yet">Add the first one below.</EmptyState> : (
        <Table>
          <THead><tr><Th>Point</Th><Th>Device</Th><Th>Every</Th><Th>Limits</Th><Th>State</Th></tr></THead>
          <tbody>{points.map((p) => (
            <tr key={p.id}>
              <Td>{p.name}<span className="block text-xs text-muted">{kindLabel(p.kind)}{p.roomName ? ` · ${p.roomName}` : ""}</span></Td>
              <Td>{p.assetId ? <Link href={`/assets/${p.assetId}`} className="font-mono text-sm text-primary hover:underline">{p.tag}</Link> : <span className="text-muted">—</span>}</Td>
              <Td>{p.everyDays} days</Td>
              <Td className="text-xs text-muted">{limitsText(p) || "No limits"}</Td>
              <Td>{p.active ? <Badge tone="ok">Sampled</Badge> : <Badge>Not sampled</Badge>}
                {canEdit && <details className="mt-2"><summary className="cursor-pointer text-sm text-primary">Edit</summary><ActionForm action={saveWaterPointAction} className="mt-3 space-y-3">
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="facilityId" value={facilityId} />
                  {fields(p)}
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p.active} /> Still sampled</label>
                  <Button>Save point</Button>
                </ActionForm></details>}
              </Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {canEdit && (
        <section aria-labelledby="add-point" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 id="add-point" className="mb-3 font-semibold">Add a sampling point</h2>
          <ActionForm action={saveWaterPointAction} className="space-y-3">
            <input type="hidden" name="facilityId" value={facilityId} />
            {fields()}
            <Button>Add point</Button>
          </ActionForm>
        </section>
      )}
    </div>
  );
}

function limitsText(p: PointRow): string {
  const r: string[] = [];
  if (p.tvcLimit != null) r.push(`TVC < ${p.tvcLimit}${p.tvcAction != null ? ` (action ${p.tvcAction})` : ""} CFU/mL`);
  if (p.endotoxinLimit != null) r.push(`endotoxin < ${p.endotoxinLimit}${p.endotoxinAction != null ? ` (action ${p.endotoxinAction})` : ""} EU/mL`);
  if (p.chlorineMax != null) r.push(`chlorine ≤ ${p.chlorineMax} mg/L`);
  if (p.freeChlorineMin != null) r.push(`free chlorine ≥ ${p.freeChlorineMin} mg/L`);
  if (p.conductivityMax != null) r.push(`conductivity ≤ ${p.conductivityMax} µS/cm`);
  if (p.coliformMax != null) r.push(`coliforms ≤ ${p.coliformMax}/100 mL`);
  return r.join(", ");
}
