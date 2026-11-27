import "server-only";
/**
 * Database side of utilities and water (wave 41). Rules are pure in ./utilities and ./water. A failed utility test or
 * water sample opens an ordinary corrective work order on the system's asset (same numbering, cover, asset status
 * effect and triage notice as any fault report), so the failure log is the work order list.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, rooms, utilitySystems, utilityTests, waterPoints, waterSamples, workOrders } from "@/db/schema";
import { scopeWhere, type Scope } from "@/lib/assets/access";
import { applyAssetEffect, coverForAsset, notifyAssigners } from "@/lib/assets/work-order-server";
import { responseDue } from "@/lib/assets/work-orders";
import { quarantineFor } from "@/lib/assets/vigilance-server";
import type { Alert } from "@/lib/notifications/alert-rules";
import { todayISO } from "@/lib/format";
import { logActivity, nextNumber } from "@/lib/server-utils";
import { dueRows, isTestKind, TEST_LABELS, type DueRow, type TestKind } from "./utilities";
import { sampleDue, type Limits } from "./water";

export type SystemRow = typeof utilitySystems.$inferSelect & { tag: string; typeName: string; typeCode: string; assetStatus: string; departmentName: string | null; roomName: string | null };

/** Utility systems of one hospital (or the scope), with their asset. */
export async function systemRows(scope: Scope, facilityId?: number): Promise<SystemRow[]> {
  const rows = await db.select({
    s: utilitySystems, tag: assets.assetTag, typeName: deviceTypes.name, typeCode: deviceTypes.code, assetStatus: assets.status, departmentName: departments.name, roomName: rooms.name,
  }).from(utilitySystems).innerJoin(assets, eq(assets.id, utilitySystems.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
    .where(and(scopeWhere(utilitySystems.facilityId, scope), facilityId ? eq(utilitySystems.facilityId, facilityId) : undefined))
    .orderBy(asc(utilitySystems.kind), asc(assets.assetTag)).limit(2000);
  return rows.map((r) => ({ ...r.s, tag: r.tag, typeName: r.typeName, typeCode: r.typeCode, assetStatus: r.assetStatus, departmentName: r.departmentName, roomName: r.roomName }));
}

/** Latest test per system and kind (`${systemId}|${kind}`). */
export async function latestTests(systemIds: number[]): Promise<Map<string, { testedOn: string; passed: boolean }>> {
  const out = new Map<string, { testedOn: string; passed: boolean }>();
  if (!systemIds.length) return out;
  const rows = await db.selectDistinctOn([utilityTests.systemId, utilityTests.kind], { systemId: utilityTests.systemId, kind: utilityTests.kind, testedOn: utilityTests.testedOn, passed: utilityTests.passed })
    .from(utilityTests).where(inArray(utilityTests.systemId, systemIds))
    .orderBy(utilityTests.systemId, utilityTests.kind, desc(utilityTests.testedOn), desc(utilityTests.id));
  for (const r of rows) out.set(`${r.systemId}|${r.kind}`, { testedOn: r.testedOn, passed: r.passed });
  return out;
}

export async function utilityDue(scope: Scope, facilityId: number | undefined, today: string): Promise<{ systems: SystemRow[]; rows: DueRow<SystemRow>[] }> {
  const systems = await systemRows(scope, facilityId);
  const last = await latestTests(systems.map((s) => s.id));
  return { systems, rows: dueRows(systems, last, today) };
}

export type PointRow = typeof waterPoints.$inferSelect & { tag: string | null; roomName: string | null; lastOn: string | null; lastLevel: string | null };

/** Water points of one hospital with their last sample. */
export async function pointRows(scope: Scope, facilityId?: number): Promise<PointRow[]> {
  const pts = await db.select({ p: waterPoints, tag: assets.assetTag, roomName: rooms.name }).from(waterPoints)
    .leftJoin(assets, eq(assets.id, waterPoints.assetId)).leftJoin(rooms, eq(rooms.id, waterPoints.roomId))
    .where(and(scopeWhere(waterPoints.facilityId, scope), facilityId ? eq(waterPoints.facilityId, facilityId) : undefined))
    .orderBy(asc(waterPoints.kind), asc(waterPoints.name)).limit(2000);
  if (!pts.length) return [];
  const last = await db.selectDistinctOn([waterSamples.pointId], { pointId: waterSamples.pointId, sampledOn: waterSamples.sampledOn, level: waterSamples.level })
    .from(waterSamples).where(inArray(waterSamples.pointId, pts.map((p) => p.p.id))).orderBy(waterSamples.pointId, desc(waterSamples.sampledOn), desc(waterSamples.id));
  const by = new Map(last.map((l) => [l.pointId, l]));
  return pts.map((r) => ({ ...r.p, tag: r.tag, roomName: r.roomName, lastOn: by.get(r.p.id)?.sampledOn ?? null, lastLevel: by.get(r.p.id)?.level ?? null }));
}

export const limitsOf = (p: typeof waterPoints.$inferSelect): Limits => ({
  tvcAction: p.tvcAction, tvcLimit: p.tvcLimit, endotoxinAction: p.endotoxinAction, endotoxinLimit: p.endotoxinLimit,
  chlorineMax: p.chlorineMax, freeChlorineMin: p.freeChlorineMin, conductivityMax: p.conductivityMax, coliformMax: p.coliformMax,
});

/**
 * Open a corrective work order for a failed test or sample. Returns null when the device is kept as found
 * (quarantined), when repair work must wait. `link(tx, woId)` ties the record to the job inside the same transaction.
 */
export async function raiseFailureJob(o: {
  assetId: number; facilityId: number; tag: string; title: string; description: string; priority: "URGENT" | "HIGH"; deviceDown: boolean;
  me: { id: number; name: string }; source: string; link: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], woId: number) => Promise<void>;
}): Promise<{ id: number; number: string } | null> {
  if (await quarantineFor(o.assetId)) return null;
  const now = new Date();
  const cover = await coverForAsset(o.assetId, todayISO(now));
  const wo = await db.transaction(async (tx) => {
    const number = await nextNumber("WO", workOrders, workOrders.number, tx);
    const [w] = await tx.insert(workOrders).values({
      number, assetId: o.assetId, facilityId: o.facilityId, type: "CORRECTIVE", priority: o.priority, status: "OPEN", title: o.title.slice(0, 200),
      description: o.description.slice(0, 4000), deviceDown: o.deviceDown, reportedById: o.me.id, reportedByName: o.me.name, reportedAt: now,
      dueAt: responseDue(now, o.priority), coverage: cover.kind, contractId: cover.kind === "CONTRACT" ? cover.contract.id : null,
      downtimeStart: o.deviceDown ? now : null,
    }).returning({ id: workOrders.id, number: workOrders.number, assetId: workOrders.assetId, deviceDown: workOrders.deviceDown });
    await o.link(tx, w.id);
    await logActivity("work_order", w.id, "reported", `Raised from ${o.source}`.slice(0, 300), o.me.name, tx);
    await logActivity("asset", o.assetId, "work_order", `${w.number} raised from ${o.source}`.slice(0, 300), o.me.name, tx);
    await applyAssetEffect("report", w, { actor: o.me.name }, tx);
    return w;
  });
  await notifyAssigners(o.facilityId, o.me.id, { kind: "work_order_reported", title: `${wo.number}: ${o.title}`.slice(0, 200), body: o.description.slice(0, 300), href: `/assets/work-orders/${wo.id}`, dedupeKey: `wo_reported:${wo.id}` });
  return { id: wo.id, number: wo.number };
}

/** Hourly alert run: overdue tests on critical systems, and overdue water samples (biomedical, the hospital). */
export async function utilityAlerts(today: string): Promise<Alert[]> {
  const out: Alert[] = [];
  const { rows } = await utilityDue(null, undefined, today);
  for (const r of rows) {
    if (!r.system.critical || r.state !== "overdue" || !isTestKind(r.test)) continue;
    const t: TestKind = r.test;
    out.push({ role: "BIOMEDICAL", facilityId: r.system.facilityId, n: {
      kind: "utility_test_overdue", title: `${r.system.tag}: ${TEST_LABELS[t].toLowerCase()} overdue`,
      body: `Due ${r.dueOn}, ${r.daysLate} day${r.daysLate === 1 ? "" : "s"} late.${r.system.serves ? ` Serves ${r.system.serves}.` : ""}`,
      href: `/buildings/utilities?facilityId=${r.system.facilityId}`, dedupeKey: `utility_test_overdue:${r.system.id}:${t}:${r.dueOn}`,
    } });
  }
  for (const p of await pointRows(null)) {
    if (!p.active) continue;
    const d = sampleDue(p.lastOn, p.everyDays, today);
    if (d.state !== "overdue") continue;
    out.push({ role: "BIOMEDICAL", facilityId: p.facilityId, n: {
      kind: "water_sample_overdue", title: `Water sample overdue: ${p.name}`, body: `Due ${d.dueOn}, ${d.daysLate} days late.`,
      href: `/buildings/water?facilityId=${p.facilityId}`, dedupeKey: `water_sample_overdue:${p.id}:${d.dueOn}`,
    } });
  }
  return out;
}

/** GAHAR pack figures for EFS.11 and EFS.12 (one hospital, or the scope). */
export async function utilityEvidence(scope: Scope, facilityId: number | null, from: string, to: string, today: string) {
  const fid = facilityId ?? undefined;
  const { systems, rows } = await utilityDue(scope, fid, today);
  const active = systems.filter((s) => s.active);
  const inDate = rows.filter((r) => r.state === "ok" || r.state === "soon" || r.state === "due").length;
  const genIds = active.filter((s) => s.kind === "GENERATOR").map((s) => s.id);
  const coldIds = active.filter((s) => s.kind === "COLD_CHAIN").map((s) => s.id);
  const period = (kinds: string[], ids: number[]) => ids.length ? db.select({ systemId: utilityTests.systemId, kind: utilityTests.kind, passed: utilityTests.passed }).from(utilityTests)
    .where(and(inArray(utilityTests.systemId, ids), inArray(utilityTests.kind, kinds), sql`${utilityTests.testedOn} between ${from} and ${to}`)).limit(50000) : Promise.resolve([]);
  const [gen, cold, failed, points] = await Promise.all([
    period(["GEN_LOAD", "GEN_NO_LOAD"], genIds), period(["COLD_CHAIN"], coldIds),
    db.select({ n: sql<number>`count(*)::int`, jobs: sql<number>`count(${utilityTests.workOrderId})::int` }).from(utilityTests)
      .where(and(scopeWhere(utilityTests.facilityId, scope), fid ? eq(utilityTests.facilityId, fid) : undefined, eq(utilityTests.passed, false), sql`${utilityTests.testedOn} between ${from} and ${to}`)),
    pointRows(scope, fid),
  ]);
  const genBoth = genIds.filter((id) => gen.some((g) => g.systemId === id && g.kind === "GEN_LOAD") && gen.some((g) => g.systemId === id && g.kind === "GEN_NO_LOAD")).length;
  const coldExc = cold.filter((c) => !c.passed).length;
  const pts = points.filter((p) => p.active);
  const ptsInDate = pts.filter((p) => { const s = sampleDue(p.lastOn, p.everyDays, today).state; return s !== "overdue" && s !== "never"; }).length;
  const samples = pts.length ? await db.select({ kind: waterPoints.kind, level: waterSamples.level, wo: waterSamples.workOrderId }).from(waterSamples)
    .innerJoin(waterPoints, eq(waterPoints.id, waterSamples.pointId))
    .where(and(inArray(waterSamples.pointId, pts.map((p) => p.id)), sql`${waterSamples.sampledOn} between ${from} and ${to}`)).limit(50000) : [];
  const dialysisPts = pts.filter((p) => p.kind.startsWith("DIALYSIS_"));
  const dialysisSampled = dialysisPts.filter((p) => p.lastOn && p.lastOn >= from).length;
  const fails = samples.filter((s) => s.level === "FAIL");
  return {
    systems: active.length, critical: active.filter((s) => s.critical).length, testsDue: rows.length, testsInDate: inDate,
    generators: genIds.length, generatorsBoth: genBoth, coldChain: coldIds.length, coldLogs: cold.length, coldExcursions: coldExc,
    failedTests: failed[0]?.n ?? 0, failedWithJob: failed[0]?.jobs ?? 0,
    points: pts.length, pointsInDate: ptsInDate, samples: samples.length, dialysisPoints: dialysisPts.length, dialysisSampled,
    sampleFails: fails.length, sampleFailsWithJob: fails.filter((s) => s.wo != null).length,
  };
}

/** The open (not yet linked) failures of a hospital, for the page. */
export async function unlinkedFailures(facilityId: number) {
  return db.select({ id: utilityTests.id }).from(utilityTests)
    .where(and(eq(utilityTests.facilityId, facilityId), eq(utilityTests.passed, false), isNull(utilityTests.workOrderId))).limit(500);
}
