import "server-only";
/**
 * Alert generator: loads candidate rows, lets ./alert-rules decide, and notifies the right people.
 * Idempotent (every alert has a dedupeKey; the unique index on (user, dedupe_key) drops repeats), so it can run on
 * startup, hourly and on demand. Runs never overlap inside one server process; across processes the unique index
 * still prevents duplicates.
 *
 * No database work happens at import time — safe to import from instrumentation, `next build` and scripts.
 */
import { and, eq, inArray, isNotNull, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets, departments, deviceTypes, facilities, maintenanceEvents, offers, projects, purchaseOrders, rfqs, suppliers,
} from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";
import { addDaysISO, todayISO } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { notifyUsers, usersWithRole } from "./index";
import { collectAlerts, digestAlerts, MAINTENANCE_DUE_DAYS, type AlertData, type AlertWindows } from "./alert-rules";

export type AlertRunResult = {
  startedAt: string; finishedAt: string; ms: number;
  /** Alerts considered (before per-user dedupe) and notifications actually created. */
  candidates: number; created: number;
  byKind: Record<string, number>;
  trigger: string;
  error?: string;
};

type State = { running: Promise<AlertRunResult> | null; last: AlertRunResult | null };
const g = globalThis as unknown as { hpamsAlerts?: State };
const state: State = (g.hpamsAlerts ??= { running: null, last: null });

/** The most recent finished run in this server process (null before the first). */
export function lastAlertRun(): AlertRunResult | null {
  return state.last;
}

export function alertRunInProgress(): boolean {
  return state.running !== null;
}

/**
 * Run the generator. If a run is already in progress, waits for that run instead of starting a second one.
 * Never throws: errors are logged and reported in the result.
 */
export function runAlerts(trigger = "manual"): Promise<AlertRunResult> {
  if (state.running) return state.running;
  const p = doRun(trigger).finally(() => { state.running = null; });
  state.running = p;
  return p;
}

async function loadData(today: string, w: AlertWindows): Promise<AlertData> {
  const offerHorizon = addDaysISO(today, w.offerExpiryWarnDays);
  const rfqHorizon = addDaysISO(today, w.rfqClosingWarnDays);
  const warrantyHorizon = addDaysISO(today, w.warrantyWarnDays);
  const maintHorizon = addDaysISO(today, w.maintenanceDueDays);

  const [offerRows, rfqRows, poRows, warrantyRows, maintRows, awardRows] = await Promise.all([
    db.select({
      id: offers.id, reference: offers.reference, status: offers.status, validUntil: offers.validUntil,
      supplierName: suppliers.name, projectCode: projects.code, facilityId: projects.facilityId,
    }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId))
      .where(and(notInArray(offers.status, ["AWARDED", "REJECTED", "WITHDRAWN"]), isNotNull(offers.validUntil),
        sql`${offers.validUntil} between ${today} and ${offerHorizon}`,
        notInArray(projects.status, ["CLOSED", "CANCELLED"]))),
    db.select({
      id: rfqs.id, number: rfqs.number, title: rfqs.title, status: rfqs.status, closingDate: rfqs.closingDate,
      projectId: rfqs.projectId, facilityId: projects.facilityId,
    }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId))
      .where(and(eq(rfqs.status, "ISSUED"), sql`${rfqs.closingDate} between ${today} and ${rfqHorizon}`)),
    db.select({
      id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, expectedDelivery: purchaseOrders.expectedDelivery,
      supplierName: suppliers.name, facilityId: purchaseOrders.facilityId,
    }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(and(notInArray(purchaseOrders.status, ["DRAFT", "PENDING_APPROVAL", "APPROVED", "DELIVERED", "CLOSED", "CANCELLED"]), lt(purchaseOrders.expectedDelivery, today))),
    db.select({
      id: assets.id, assetTag: assets.assetTag, typeName: deviceTypes.name, status: assets.status, warrantyEnd: assets.warrantyEnd,
      facilityId: assets.facilityId, supplierName: suppliers.name, departmentName: departments.name,
    }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .leftJoin(suppliers, eq(suppliers.id, assets.supplierId)).leftJoin(departments, eq(departments.id, assets.departmentId))
      .where(and(sql`${assets.status} <> 'DISPOSED'`, sql`${assets.warrantyEnd} between ${today} and ${warrantyHorizon}`)),
    db.select({
      id: maintenanceEvents.id, assetId: maintenanceEvents.assetId, assetTag: assets.assetTag, typeName: deviceTypes.name,
      type: maintenanceEvents.type, status: maintenanceEvents.status, scheduledDate: maintenanceEvents.scheduledDate,
      assetStatus: assets.status, facilityId: assets.facilityId, departmentName: departments.name,
    }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(departments, eq(departments.id, assets.departmentId))
      .where(and(inArray(maintenanceEvents.status, ["SCHEDULED", "IN_PROGRESS", "OVERDUE"]), lte(maintenanceEvents.scheduledDate, maintHorizon),
        sql`${assets.status} <> 'DISPOSED'`)),
    db.select({
      id: offers.id, reference: offers.reference, status: offers.status, complaintUntil: offers.complaintUntil,
      acceptanceDue: offers.acceptanceDue, acceptedOn: offers.acceptedOn,
      supplierName: suppliers.name, projectCode: projects.code, facilityId: projects.facilityId,
    }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId))
      .where(and(eq(offers.status, "AWARDED"), lt(offers.complaintUntil, today), isNull(offers.acceptedOn))),
  ]);
  return { offers: offerRows, rfqs: rfqRows, pos: poRows, warranties: warrantyRows, maintenance: maintRows, awards: awardRows };
}

async function doRun(trigger: string): Promise<AlertRunResult> {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const byKind: Record<string, number> = {};
  let candidates = 0, created = 0, error: string | undefined;
  try {
    const s = await getSettings();
    const windows: AlertWindows = {
      offerExpiryWarnDays: clampDays(s.offerExpiryWarnDays, 14),
      warrantyWarnDays: clampDays(s.warrantyWarnDays, 90),
      rfqClosingWarnDays: clampDays(s.rfqClosingWarnDays, 3),
      maintenanceDueDays: MAINTENANCE_DUE_DAYS,
    };
    const today = todayISO();
    const names = new Map((await db.select({ id: facilities.id, name: facilities.name }).from(facilities)).map((f) => [f.id, f.name]));
    const alerts = digestAlerts(collectAlerts(await loadData(today, windows), today, windows), today, windows, (id) => (id == null ? null : names.get(id) ?? null));
    candidates = alerts.length;

    // One recipient lookup per role and facility per run.
    const recipients = new Map<string, Promise<number[]>>();
    const who = (role: Role, facilityId: number | null) => {
      const k = `${role}:${facilityId ?? "*"}`;
      if (!recipients.has(k)) recipients.set(k, usersWithRole(role, facilityId));
      return recipients.get(k)!;
    };
    for (const a of alerts) {
      const n = await notifyUsers(await who(a.role, a.facilityId), a.n);
      if (n) { created += n; byKind[a.n.kind] = (byKind[a.n.kind] ?? 0) + n; }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error("[alerts] run failed:", e);
  }
  const result: AlertRunResult = {
    startedAt, finishedAt: new Date().toISOString(), ms: Date.now() - t0, candidates, created, byKind, trigger, ...(error ? { error } : {}),
  };
  state.last = result;
  if (created || error) console.log(`[alerts] ${trigger}: ${created} new notification(s) from ${candidates} alert(s) in ${result.ms} ms${error ? ` — error: ${error}` : ""}`);
  return result;
}

function clampDays(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 3650) : fallback;
}
