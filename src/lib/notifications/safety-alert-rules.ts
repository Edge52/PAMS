/**
 * Wave 37: more alerts for the hourly run, as pure functions over plain rows (loading in ./safety-alerts.ts):
 * recalls still to action, parts at or below their reorder level, electrical safety tests, test equipment and
 * clinical device calibration, ENRRA licences, physicist QC tests, protective equipment checks and dose readings.
 *
 * Deduplication follows the existing alerts: dated items get one alert per item, due date and stage ("due" a
 * while ahead, then "overdue"), so a new date raises a fresh one. States with no date of their own (a recall still
 * pending, stock still low) repeat once a day per item. Loans overdue are already sent by notifyOverdueLoans.
 */
import { daysBetween } from "../assets/dates";
import { CHECK_WARN_DAYS, LICENCE_WARN_DAYS, PROTECTIVE_KIND_LABELS, type ProtectiveKind } from "../assets/radiation";
import type { Alert } from "./alert-rules";

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const inDays = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const where = (dept: string | null | undefined) => (dept ? `, ${dept}` : "");

/** "due" inside the window, "overdue" once past, null when not yet inside the window. */
export function stage(due: string | null | undefined, today: string, warnDays: number): "due" | "overdue" | null {
  if (!due) return null;
  const d = daysBetween(today, due);
  if (d < 0) return "overdue";
  return d <= warnDays ? "due" : null;
}
const when = (due: string, today: string) => {
  const d = daysBetween(today, due);
  return d < 0 ? `was due ${fmt(due)} (${plural(-d, "day")} ago)` : `is due ${inDays(d)} (${fmt(due)})`;
};

/* ── Recalls still to action ── */

export type RecallPendingRow = { recallId: number; number: string; title: string; urgent: boolean; dueDate: string | null; facilityId: number; pending: number };

export function recallPendingAlerts(rows: RecallPendingRow[], today: string): Alert[] {
  return rows.filter((r) => r.pending > 0).map((r) => {
    const late = r.dueDate != null && r.dueDate < today;
    return {
      role: "BIOMEDICAL" as const, facilityId: r.facilityId,
      n: {
        kind: "recall_pending",
        title: `${r.urgent ? "Urgent recall" : "Recall"} ${r.number}: ${plural(r.pending, "device")} still to action${late ? " (past its due date)" : ""}`,
        body: `${r.title}.${r.dueDate ? ` Action due by ${fmt(r.dueDate)}.` : ""} Inspect or fix each device, or mark it not affected.`,
        href: `/assets/recalls/${r.recallId}`,
        dedupeKey: `recall_pending:${r.recallId}:${r.facilityId}:${today}`,
      },
    };
  });
}

/* ── Parts at or below the reorder level ── */

export type LowPartRow = { id: number; name: string; partNumber: string; stock: number; min: number; facilityId: number };

/** Same key as the alert sent when a movement crosses the minimum (parts-server notifyIfLow), so one a day at most. */
export function lowStockAlerts(rows: LowPartRow[], today: string): Alert[] {
  return rows.filter((p) => p.min > 0 && p.stock <= p.min).map((p) => ({
    role: "BIOMEDICAL" as const, facilityId: p.facilityId,
    n: {
      kind: "part_low_stock",
      title: `${p.name} (${p.partNumber}): ${p.stock === 0 ? "out of stock" : `only ${p.stock} left`}`,
      body: `Stock is at or below the reorder level of ${p.min}. Reorder it.`,
      href: `/assets/parts/${p.id}`,
      dedupeKey: `part_low:${p.id}:${today}`,
    },
  }));
}

/* ── Device checks with a next due date: safety tests and calibration ── */

export type DeviceDueRow = { assetId: number; tag: string; typeName: string; departmentName: string | null; nextDue: string; facilityId: number };

function deviceDue(rows: DeviceDueRow[], today: string, o: { kind: string; label: string; anchor: string; warnDays: number; roles: readonly ("BIOMEDICAL" | "TECHNICIAN")[] }): Alert[] {
  const out: Alert[] = [];
  for (const r of rows) {
    const s = stage(r.nextDue, today, o.warnDays);
    if (!s) continue;
    const n = {
      kind: `${o.kind}_${s}`,
      title: `${o.label} ${s === "overdue" ? "overdue" : `due ${inDays(daysBetween(today, r.nextDue))}`}: ${r.tag}`,
      body: `${r.typeName}${where(r.departmentName)}: the ${o.label.toLowerCase()} ${when(r.nextDue, today)}.`,
      href: `/assets/${r.assetId}#${o.anchor}`,
      dedupeKey: `${o.kind}_${s}:${r.assetId}:${r.nextDue}`,
    };
    for (const role of o.roles) out.push({ role, facilityId: r.facilityId, n });
  }
  return out;
}

export const safetyTestAlerts = (rows: DeviceDueRow[], today: string) =>
  deviceDue(rows, today, { kind: "safety_test", label: "Safety test", anchor: "safety-tests", warnDays: CHECK_WARN_DAYS, roles: ["BIOMEDICAL", "TECHNICIAN"] });
export const calibrationAlerts = (rows: DeviceDueRow[], today: string) =>
  deviceDue(rows, today, { kind: "calibration", label: "Calibration", anchor: "calibration", warnDays: CHECK_WARN_DAYS, roles: ["BIOMEDICAL", "TECHNICIAN"] });

export type TestEquipmentRow = { assetId: number; tag: string; label: string; calibrationDue: string; facilityId: number };

/** A safety analyser whose calibration runs out can't be used for tests: biomedical books the recalibration. */
export function testEquipmentAlerts(rows: TestEquipmentRow[], today: string): Alert[] {
  return rows.flatMap((r) => {
    const s = stage(r.calibrationDue, today, CHECK_WARN_DAYS);
    if (!s) return [];
    return [{
      role: "BIOMEDICAL" as const, facilityId: r.facilityId,
      n: {
        kind: "test_equipment_calibration",
        title: `Test equipment ${r.tag}: calibration ${s === "overdue" ? "has run out" : `runs out ${inDays(daysBetween(today, r.calibrationDue))}`}`,
        body: `${r.label}: calibration ${s === "overdue" ? `ran out on ${fmt(r.calibrationDue)}. Tests can't be recorded with it until it is recalibrated.` : `runs out on ${fmt(r.calibrationDue)}. Book the recalibration.`}`,
        href: `/assets/${r.assetId}`,
        dedupeKey: `test_eq_cal:${r.assetId}:${r.calibrationDue}:${s}`,
      },
    }];
  });
}

/* ── Radiation safety ── */

export type LicenceRow = { id: number; licenceNumber: string; expiresOn: string; covers: string; facilityId: number };

export function licenceAlerts(rows: LicenceRow[], today: string, warnDays = LICENCE_WARN_DAYS): Alert[] {
  return rows.flatMap((l) => {
    const s = stage(l.expiresOn, today, warnDays);
    if (!s) return [];
    return [{
      role: "BIOMEDICAL" as const, facilityId: l.facilityId,
      n: {
        kind: s === "overdue" ? "radiation_licence_expired" : "radiation_licence_expiring",
        title: `ENRRA licence ${l.licenceNumber} ${s === "overdue" ? "has expired" : `expires ${inDays(daysBetween(today, l.expiresOn))}`}`,
        body: `${l.covers}: the licence ${s === "overdue" ? `expired on ${fmt(l.expiresOn)}. The room or device must not be used until it is renewed.` : `expires on ${fmt(l.expiresOn)}. Apply for the renewal now.`}`,
        href: `/assets/radiation/licences/${l.id}`,
        dedupeKey: `enrra_licence:${l.id}:${l.expiresOn}:${s}`,
      },
    }];
  });
}

export type QcDueRow = { id: number; testName: string; label: string; nextDue: string; facilityId: number };

export function qcAlerts(rows: QcDueRow[], today: string): Alert[] {
  return rows.flatMap((q) => {
    const s = stage(q.nextDue, today, CHECK_WARN_DAYS);
    if (!s) return [];
    return [{
      role: "BIOMEDICAL" as const, facilityId: q.facilityId,
      n: {
        kind: `radiation_qc_${s}`,
        title: `Physicist QC ${s === "overdue" ? "overdue" : `due ${inDays(daysBetween(today, q.nextDue))}`}: ${q.label}`,
        body: `${q.testName} ${when(q.nextDue, today)}. Book the medical physicist.`,
        href: `/assets/radiation?facilityId=${q.facilityId}&tab=qc`,
        dedupeKey: `radiation_qc_${s}:${q.id}:${q.nextDue}`,
      },
    }];
  });
}

export type ProtectiveDueRow = { itemId: number; label: string; kind: string; nextDue: string; facilityId: number };

export function protectiveAlerts(rows: ProtectiveDueRow[], today: string): Alert[] {
  return rows.flatMap((p) => {
    const s = stage(p.nextDue, today, CHECK_WARN_DAYS);
    if (!s) return [];
    const kind = PROTECTIVE_KIND_LABELS[p.kind as ProtectiveKind] ?? "Protective item";
    return [{
      role: "BIOMEDICAL" as const, facilityId: p.facilityId,
      n: {
        kind: `protective_check_${s}`,
        title: `${kind} check ${s === "overdue" ? "overdue" : `due ${inDays(daysBetween(today, p.nextDue))}`}: ${p.label}`,
        body: `The check of ${p.label} ${when(p.nextDue, today)}. Inspect it and screen it for cracks.`,
        href: `/assets/radiation?facilityId=${p.facilityId}&tab=protective`,
        dedupeKey: `protective_check_${s}:${p.itemId}:${p.nextDue}`,
      },
    }];
  });
}

export type DoseRow = { id: number; personName: string; periodEnd: string; doseMsv: number; limitMsv: number; flag: string; facilityId: number };

/** One alert per flagged reading. */
export function doseAlerts(rows: DoseRow[]): Alert[] {
  return rows.filter((d) => d.flag === "OVER" || d.flag === "INVESTIGATE").map((d) => ({
    role: "BIOMEDICAL" as const, facilityId: d.facilityId,
    n: {
      kind: "dose_flagged",
      title: `${d.flag === "OVER" ? "Dose over the limit" : "Dose to investigate"}: ${d.personName}`,
      body: `Badge reading to ${fmt(d.periodEnd)}: ${d.doseMsv} mSv against a period limit of ${d.limitMsv} mSv. Look into it with the radiation protection officer.`,
      href: `/assets/radiation?facilityId=${d.facilityId}&tab=dosimetry`,
      dedupeKey: `dose_flagged:${d.id}`,
    },
  }));
}

export type SafetyAlertData = {
  recalls: RecallPendingRow[]; parts: LowPartRow[]; safetyTests: DeviceDueRow[]; calibrations: DeviceDueRow[]; testEquipment: TestEquipmentRow[];
  licences: LicenceRow[]; qc: QcDueRow[]; protective: ProtectiveDueRow[]; doses: DoseRow[];
};

export function collectSafetyAlerts(d: SafetyAlertData, today: string): Alert[] {
  return [
    ...recallPendingAlerts(d.recalls, today), ...lowStockAlerts(d.parts, today),
    ...safetyTestAlerts(d.safetyTests, today), ...calibrationAlerts(d.calibrations, today), ...testEquipmentAlerts(d.testEquipment, today),
    ...licenceAlerts(d.licences, today), ...qcAlerts(d.qc, today), ...protectiveAlerts(d.protective, today), ...doseAlerts(d.doses),
  ];
}
