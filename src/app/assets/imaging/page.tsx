import Link from "next/link";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, imagingUsage, rooms, typeCapacity, workOrders } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Stat, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { lifecycle } from "@/lib/assets/maintenance";
import { CAPACITY_HINTS, usage } from "@/lib/assets/planning";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatNumber, todayISO } from "@/lib/format";
import { importUsageAction, saveCapacityAction, saveUsageAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Imaging use" };

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Imaging utilisation and capacity (wave 9, D3): exams against planning capacity, uptime, lost exams, per scanner. */
export default async function ImagingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Imaging use" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  // Period: a calendar year, or the last 12 full months.
  const now = new Date();
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : null;
  const from = year ? new Date(Date.UTC(year, 0, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
  const toFull = year ? new Date(Date.UTC(year + 1, 0, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = toFull < now ? toFull : now;
  const months = Math.max(1, Math.round((to.getTime() - from.getTime()) / (30.44 * 864e5)));
  const label = year ? String(year) : `${ym(from)} to ${ym(new Date(toFull.getTime() - 864e5))}`;

  const scanners = await db.select({ id: assets.id, tag: assets.assetTag, typeId: deviceTypes.id, typeName: deviceTypes.name, typeCode: deviceTypes.code, model: assets.model,
    room: rooms.name, installDate: sql<string | null>`coalesce(${assets.installDate}, ${assets.purchaseDate})`, lifeYears: sql<number | null>`coalesce(${assets.lifeExpectancyYears}, ${deviceTypes.lifeExpectancyYears})` })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
    .where(and(eq(assets.facilityId, facilityId), sql`${deviceTypes.code} like 'IMG-%' and ${deviceTypes.code} not like 'IMG-ACC%'`, sql`${assets.status} not in ('DISPOSED','IN_STOCK')`))
    .orderBy(asc(deviceTypes.name), asc(assets.assetTag));
  const ids = scanners.map((s) => s.id);
  const [use, down, faults, caps] = ids.length ? await Promise.all([
    db.select({ assetId: imagingUsage.assetId, exams: sql<number>`sum(${imagingUsage.exams})::int`, hours: sql<number | null>`sum(${imagingUsage.scheduledHours})::float`, n: sql<number>`count(*)::int`,
      withHours: sql<number>`count(${imagingUsage.scheduledHours})::int` })
      .from(imagingUsage).where(and(inArray(imagingUsage.assetId, ids), sql`${imagingUsage.month} >= ${`${ym(from)}-01`} and ${imagingUsage.month} < ${`${ym(toFull)}-01`}`)).groupBy(imagingUsage.assetId),
    db.select({ assetId: workOrders.assetId, h: sql<number>`sum(greatest(0, extract(epoch from (least(coalesce(${workOrders.downtimeEnd}, now()), ${to.toISOString()}::timestamptz) - greatest(${workOrders.downtimeStart}, ${from.toISOString()}::timestamptz))) / 3600))::float` })
      .from(workOrders).where(and(inArray(workOrders.assetId, ids), sql`${workOrders.downtimeStart} is not null and ${workOrders.status} <> 'CANCELLED' and ${workOrders.downtimeStart} < ${to.toISOString()}::timestamptz`)).groupBy(workOrders.assetId),
    db.select({ assetId: workOrders.assetId, last: sql<string>`max(${workOrders.reportedAt})` }).from(workOrders)
      .where(and(inArray(workOrders.assetId, ids), eq(workOrders.type, "CORRECTIVE"), sql`${workOrders.status} <> 'CANCELLED'`)).groupBy(workOrders.assetId),
    db.select().from(typeCapacity).where(inArray(typeCapacity.deviceTypeId, [...new Set(scanners.map((s) => s.typeId))])),
  ]) : [[], [], [], []];
  const capOf = new Map(caps.map((c) => [c.deviceTypeId, c.examsPerYear]));
  const today = todayISO();
  const rows = scanners.map((s) => {
    const u = use.find((x) => x.assetId === s.id);
    const dH = down.find((x) => x.assetId === s.id)?.h ?? 0;
    const m = u?.n ?? 0;
    // Exams are compared with capacity over the months that have entries (a scanner installed mid-year isn't penalised).
    const r = usage({ exams: u?.exams ?? 0, scheduledHours: u && u.withHours === u.n ? u.hours : null, downtimeH: dH, capacityPerYear: capOf.get(s.typeId) ?? null, months: m || months });
    const lastFault = faults.find((x) => x.assetId === s.id)?.last;
    const life = lifecycle(s.installDate, s.lifeYears, today);
    const endYear = s.installDate && s.lifeYears ? Number(s.installDate.slice(0, 4)) + s.lifeYears : null;
    return { ...s, ...r, months: m, downtimeH: dH, uptime: 1 - dH / ((to.getTime() - from.getTime()) / 3.6e6), daysSinceFault: lastFault ? Math.floor((now.getTime() - new Date(lastFault).getTime()) / 864e5) : null,
      lifeSoon: endYear != null && endYear <= now.getUTCFullYear() + 2, lifePct: life.pctUsed, endYear };
  });
  const withData = rows.filter((r) => r.months > 0);
  const total = withData.reduce((s, r) => s + r.exams, 0);
  const lost = withData.reduce((s, r) => s + (r.lostExams ?? 0), 0);
  const utils = withData.filter((r) => r.utilisation != null);
  const busiest = [...utils].sort((a, b) => b.utilisation! - a.utilisation!);
  const over = busiest.filter((r) => r.utilisation! > 1);
  const canEdit = can(me.role, "assets.edit"), canCap = can(me.role, "catalogue.edit");
  const types = [...new Map(scanners.map((s) => [s.typeId, s])).values()];
  const lastMonth = ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const facName = facs.find((f) => f.id === facilityId)?.name ?? "";

  return (
    <>
      <PageHeader title="Imaging use" description="Exams per scanner against planning capacity, with uptime and the exams lost to downtime. Feeds the capital plan and tender justifications." />
      <Notice sp={sp} />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
        <Field label="Period"><NativeSelect name="year" value={year ?? ""} placeholder="Last 12 months" options={[0, 1, 2, 3].map((k) => now.getUTCFullYear() - k).map((y) => ({ value: y, label: String(y) }))} /></Field>
        <Button variant="secondary">Show</Button>
      </form>
      {scanners.length === 0 ? <EmptyState title="No imaging equipment registered">Scanners appear here once they are in the asset register.</EmptyState> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Scanners" value={formatNumber(scanners.length)} hint={`${withData.length} with figures for ${label}`} />
            <Stat label="Exams" value={formatNumber(total)} />
            <Stat label="Busiest" value={busiest[0] ? pct(busiest[0].utilisation) : "—"} hint={busiest[0] ? `${busiest[0].tag}, ${busiest[0].typeName}` : "Set capacities below"} />
            <Stat label="Exams lost to downtime" value={formatNumber(lost)} hint="Estimated from downtime and the exam rate" />
          </div>
          <Panel title={`Scanners — ${label}`} padded={false}>
            <div className="overflow-x-auto"><table className="w-full text-[13px]">
              <thead className="bg-sunken text-left text-muted"><tr>
                {["Scanner", "Exams", "Capacity", "Use", "Uptime", "Exams / up hour", "Lost exams", "Last fault", "Life"].map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i ? "text-right" : ""}`}>{h}</th>)}
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2"><Link href={`/assets/${r.id}`} className="font-mono text-primary hover:underline">{r.tag}</Link><div className="text-xs text-muted">{r.typeName}{r.room ? ` · ${r.room}` : ""}</div></td>
                  <td className="px-3 py-2 text-right">{r.months ? formatNumber(r.exams) : <span className="text-muted">no figures</span>}{r.months && r.months < months ? <div className="text-xs text-muted">{r.months} months</div> : null}</td>
                  <td className="px-3 py-2 text-right">{r.capacity != null ? formatNumber(Math.round(r.capacity)) : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.utilisation != null && r.months ? <Badge tone={r.utilisation > 1 ? "danger" : r.utilisation > 0.85 ? "warn" : "ok"}>{pct(r.utilisation)}</Badge> : "—"}</td>
                  <td className="px-3 py-2 text-right">{(r.uptime * 100).toFixed(1)} %<div className="text-xs text-muted">{Math.round(r.downtimeH)} h down</div></td>
                  <td className="px-3 py-2 text-right">{r.perUptimeHour != null ? r.perUptimeHour.toFixed(2) : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.months && r.lostExams != null ? formatNumber(r.lostExams) : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.daysSinceFault != null ? `${r.daysSinceFault} days ago` : "never"}</td>
                  <td className="px-3 py-2 text-right">{r.lifeSoon ? <Badge tone="warn">ends {r.endYear}</Badge> : r.endYear ? r.endYear : "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Panel>
          {over.length > 0 && (
            <Panel title="For tender justifications" className="mt-6">
              <ul className="space-y-1 text-sm">{over.map((r) => (
                <li key={r.id}>{r.typeName} {r.tag} in {facName} ran at {pct(r.utilisation)} of its planned capacity ({formatNumber(r.exams)} exams against {formatNumber(Math.round(r.capacity!))}) in {label}{r.lostExams ? `, losing about ${formatNumber(r.lostExams)} exams to ${Math.round(r.downtimeH)} hours of downtime` : ""}.</li>
              ))}</ul>
            </Panel>
          )}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {canEdit && (
              <Panel title="Enter a month">
                <ActionForm action={saveUsageAction} className="space-y-3">
                  <Field label="Scanner"><NativeSelect name="assetId" required placeholder="Choose…" options={scanners.map((s) => ({ value: s.id, label: `${s.tag} — ${s.typeName}` }))} /></Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Month"><Input type="month" name="month" required defaultValue={lastMonth} /></Field>
                    <Field label="Exams" hint="Blank removes the month."><Input type="number" name="exams" min={0} /></Field>
                    <Field label="Scheduled hours" hint="Hours it was meant to run."><Input type="number" name="scheduledHours" min={0} max={744} step="0.5" /></Field>
                  </div>
                  <Button>Save</Button>
                </ActionForm>
                <ActionForm action={importUsageAction} className="mt-5 space-y-3 border-t border-line pt-4">
                  <Field label="Or paste rows" hint="tag, month, exams, scheduled hours (optional) — one per line, e.g. LPH-IMG-000400, 2026-09, 1050, 360. From the RIS or a spreadsheet.">
                    <Textarea name="rows" rows={4} className="font-mono text-[13px]" />
                  </Field>
                  <Button variant="secondary">Import</Button>
                </ActionForm>
              </Panel>
            )}
            <Panel title="Planning capacity">
              <p className="mb-3 text-sm text-muted">Exams a year one scanner of each type is planned to do. Use your own planning figures; the suggestions are only a starting point.</p>
              <ul className="space-y-2">{types.map((t) => (
                <li key={t.typeId} className="text-sm">
                  {canCap ? (
                    <ActionForm action={saveCapacityAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="deviceTypeId" value={t.typeId} />
                      <Field label={t.typeName} className="min-w-48 flex-1"><Input type="number" name="examsPerYear" min={1} defaultValue={capOf.get(t.typeId) ?? ""} placeholder={CAPACITY_HINTS[t.typeCode] ? `e.g. ${CAPACITY_HINTS[t.typeCode].toLocaleString("en")}` : "exams a year"} /></Field>
                      <Button variant="secondary">Save</Button>
                    </ActionForm>
                  ) : <p>{t.typeName}: {capOf.get(t.typeId) ? `${formatNumber(capOf.get(t.typeId)!)} exams a year` : "not set"}</p>}
                </li>
              ))}</ul>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
