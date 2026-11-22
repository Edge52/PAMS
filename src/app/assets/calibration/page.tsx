import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, facilities } from "@/db/schema";
import { Badge, Button, EmptyState, PageHeader, Panel, Stat, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { SortTh } from "@/components/ui/sort-th";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import {
  byDepartment, CALIBRATION_RESULT_LABELS, CALIBRATION_STATE_LABELS, CALIBRATION_STATE_TONE, calibrationCompliance, type CalibrationResult,
} from "@/lib/assets/calibration";
import { calibrationDevices, calibrationsLastYear } from "@/lib/assets/calibration-server";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { capRows, parseSort, sortRows } from "@/lib/list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calibration" };

const TABS = ["due", "failed", "never", "departments", "all"] as const;

/** Calibration of clinical devices (wave 37): what is due or overdue, by department, and the compliance figure. */
export default async function CalibrationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "due";
  const today = todayISO();
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || null);
  const departmentId = Number(sp.departmentId) || undefined;
  const [facs, depts, devices, lastYear] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)),
    db.select({ id: departments.id, name: departments.name, facility: facilities.name }).from(departments).innerJoin(facilities, eq(facilities.id, departments.facilityId))
      .where(and(scopeWhere(departments.facilityId, scope), facilityId ? eq(departments.facilityId, facilityId) : undefined)).orderBy(asc(facilities.name), asc(departments.name)),
    calibrationDevices(scope, today, { facilityId, departmentId }),
    calibrationsLastYear(scope),
  ]);
  const comp = calibrationCompliance(devices.map((d) => d.state));
  const count = (s: string) => devices.filter((d) => d.state === s).length;
  const due = devices.filter((d) => d.state === "overdue" || d.state === "soon");
  const list = tab === "due" ? due : tab === "failed" ? devices.filter((d) => d.state === "failed") : tab === "never" ? devices.filter((d) => d.state === "never") : devices;
  const sort = parseSort(sp, ["device", "department", "last", "next"] as const, { key: "next", dir: "asc" });
  const sorted = sortRows(list, sort, { device: (r) => r.tag, department: (r) => r.departmentName ?? "", last: (r) => r.last?.calibratedOn ?? "", next: (r) => r.last?.nextDue ?? "" });
  const { rows, note } = capRows(sorted, 500, "devices");
  const depRows = byDepartment(devices);
  const q = (t: string) => `/assets/calibration?tab=${t}${facilityId ? `&facilityId=${facilityId}` : ""}${departmentId ? `&departmentId=${departmentId}` : ""}`;

  return (
    <>
      <PageHeader title="Calibration" description="Clinical devices whose type needs calibration: when each was last calibrated, the result and when it is due again. Record a calibration from the device's own page. A failed calibration takes the device out of service until it passes." />
      <Notice sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Calibration compliance" value={comp.pct == null ? "—" : `${formatNumber(comp.pct, 1)} %`} hint={`${formatNumber(comp.inDate)} of ${formatNumber(comp.counted)} devices in date`} href={q("departments")} />
        <Stat label="Due or overdue" value={formatNumber(due.length)} hint={`${formatNumber(count("overdue"))} overdue`} href={q("due")} />
        <Stat label="Failed, out of service" value={formatNumber(count("failed"))} href={q("failed")} />
        <Stat label="Never calibrated" value={formatNumber(count("never"))} hint={`${formatNumber(lastYear)} calibrations in 12 months`} href={q("never")} />
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <AutoSubmit />
        <input type="hidden" name="tab" value={tab} />
        {facs.length > 1 && <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} placeholder="All hospitals" options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>}
        <label><span className="sr-only">Department</span><NativeSelect name="departmentId" aria-label="Department" value={departmentId} placeholder="All departments" options={depts.map((d) => ({ value: d.id, label: facs.length > 1 && !facilityId ? `${d.name} (${d.facility})` : d.name }))} /></label>
        <Button variant="secondary">Filter</Button>
      </form>
      <TabLinks active={tab} tabs={[
        { key: "due", label: `Due (${due.length})`, href: q("due") }, { key: "failed", label: `Failed (${count("failed")})`, href: q("failed") },
        { key: "never", label: `Never calibrated (${count("never")})`, href: q("never") }, { key: "departments", label: "By department", href: q("departments") },
        { key: "all", label: `All (${devices.length})`, href: q("all") },
      ]} />
      {devices.length === 0 ? (
        <EmptyState title="No device needs calibration here">A device appears here when its device type is marked &quot;Needs calibration&quot; in the device catalogue.</EmptyState>
      ) : tab === "departments" ? (
        <Table>
          <THead><tr><Th>Department</Th><Th className="text-right">Devices</Th><Th className="text-right">In date</Th><Th className="text-right">Due soon</Th><Th className="text-right">Overdue</Th><Th className="text-right">Failed</Th><Th className="text-right">Never</Th><Th className="text-right">Compliance</Th></tr></THead>
          <tbody>{depRows.map((r) => (
            <tr key={String(r.departmentId)}>
              <Td>{r.departmentId ? <Link href={`/assets/calibration?tab=all&departmentId=${r.departmentId}`} className="text-primary hover:underline">{r.name}</Link> : r.name}</Td>
              <Td className="text-right">{r.total}</Td><Td className="text-right">{r.ok}</Td><Td className="text-right">{r.soon}</Td>
              <Td className="text-right">{r.overdue}</Td><Td className="text-right">{r.failed}</Td><Td className="text-right">{r.never}</Td>
              <Td className="text-right"><Badge tone={r.pct == null ? "neutral" : r.pct >= 95 ? "ok" : r.pct >= 80 ? "warn" : "danger"}>{r.pct == null ? "—" : `${formatNumber(r.pct, 1)} %`}</Badge></Td>
            </tr>
          ))}</tbody>
        </Table>
      ) : rows.length === 0 ? (
        <EmptyState title={tab === "due" ? "Nothing due in the next 30 days" : tab === "failed" ? "No failed calibrations" : tab === "never" ? "Every device has a calibration on record" : "No devices"}>Every device listed under All is in date.</EmptyState>
      ) : (
        <>
          {note && <p role="note" className="mb-2 text-sm text-warn">{note}</p>}
          <Table>
            <THead><tr><SortTh k="device">Device</SortTh><SortTh k="department">Department</SortTh><SortTh k="last">Last calibration</SortTh><SortTh k="next">Next due</SortTh><Th className="hidden md:table-cell">Interval</Th></tr></THead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}>
                <Td><Link href={`/assets/${d.id}#calibration`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.tag}</Link><span className="block text-xs text-muted">{d.typeName}</span></Td>
                <Td>{d.departmentName ?? "—"}{d.roomName && <span className="block text-xs text-muted">{d.roomName}</span>}</Td>
                <Td className="whitespace-nowrap">{d.last ? <><Link href={`/assets/calibration/${d.last.id}`} className="text-primary hover:underline">{formatDate(d.last.calibratedOn)}</Link><span className="block text-xs text-muted">{CALIBRATION_RESULT_LABELS[d.last.result as CalibrationResult]} · {d.last.performedBy}</span></> : <span className="text-muted">None</span>}</Td>
                <Td className="whitespace-nowrap">{d.last?.nextDue ? `${formatDate(d.last.nextDue)} ` : ""}<Badge tone={CALIBRATION_STATE_TONE[d.state]}>{CALIBRATION_STATE_LABELS[d.state]}</Badge></Td>
                <Td className="hidden md:table-cell">Every {d.months} months{d.intervalSource === "device" ? " (this device)" : d.intervalSource === "default" ? " (default)" : ""}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </>
      )}
      <Panel title="How compliance is worked out" className="mt-6">
        <p className="text-sm text-muted">Devices that need calibration and are installed, in service, under maintenance, out of service or on loan count. A device is in date when its last calibration passed (as found, or after adjustment) and its next due date has not passed. Failed, overdue and never calibrated devices count against the figure. Test equipment (safety analysers) is listed under Safety tests.</p>
      </Panel>
    </>
  );
}
