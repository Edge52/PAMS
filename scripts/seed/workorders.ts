/**
 * Demo work orders (wave 3). Runs after the asset and CAD seeds:
 *  - every device the demo left out of service or under maintenance gets an open job (reported, assigned, in progress
 *    or on hold), so the asset status and the work order agree;
 *  - about 40 finished corrective jobs over the last 90 days, with downtime and a maintenance history entry, so the
 *    response, MTTR and downtime figures have something to show.
 * Tolerates missing users (assignments are left empty) and missing assets (nothing to do).
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { activityLog, assets, maintenanceEvents, users, workOrders } from "../../src/db/schema";
import { responseDue, suggestedPriority, type WorkOrderPriority } from "../../src/lib/assets/work-orders";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const FAULTS = [
  ["Screen stays black after power on", "Power supply board replaced; tested against the checklist."],
  ["Alarm sounds with no reading", "SpO2 sensor cable damaged; cable replaced and alarms tested."],
  ["Battery drains within 20 minutes", "Battery pack past its life; new pack fitted and calibrated."],
  ["Error E-21 on start-up", "Firmware fault; reflashed with the vendor's current version."],
  ["Occlusion alarm on every syringe", "Plunger sensor cleaned and recalibrated."],
  ["Cracked housing after a fall", "Front housing replaced; electrical safety test passed."],
  ["Readings drift from the reference", "Recalibrated against the reference standard."],
  ["Won't charge on the dock", "Dock contacts cleaned; charging circuit fuse replaced."],
] as const;
const HOLD = ["Waiting for a spare part from the vendor", "Vendor engineer visit booked", "Waiting for a quotation approval"];

const H = 3_600_000;

export default async function seed(db: DB) {
  const down = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, criticality: assets.criticality, notes: assets.notes })
    .from(assets).where(inArray(assets.status, ["OUT_OF_SERVICE", "UNDER_MAINTENANCE"])).orderBy(assets.id);
  const working = await db.select({ id: assets.id, facilityId: assets.facilityId, criticality: assets.criticality })
    .from(assets).where(eq(assets.status, "IN_SERVICE")).orderBy(assets.id).limit(400);
  if (!down.length && !working.length) { console.log("  workorders: no assets, skipped"); return; }

  const people = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const by = (e: string) => people.find((p) => p.email === e);
  const tech = by("technician@demo.hpams"), lead = by("biomedical@demo.hpams"), nurse = by("icu@demo.hpams"), admin = by("admin@demo.hpams");
  const reporters = [nurse, by("viewer@demo.hpams"), lead].filter((p): p is NonNullable<typeof p> => !!p);

  const r = rng(20261031);
  const now = Date.now();
  const year = new Date().getFullYear();
  let n = Number((await db.execute<{ m: number }>(sql`select coalesce(max(nullif(substring(number from '[0-9]+$'), '')::int), 0)::int as m from work_orders where number like ${`WO-${year}-%`}`)).rows[0]?.m ?? 0);
  const nextNo = () => `WO-${year}-${String(++n).padStart(4, "0")}`;
  const log: (typeof activityLog.$inferInsert)[] = [];
  let created = 0;

  // Finished jobs over the last 90 days.
  for (let i = 0; i < Math.min(40, working.length); i++) {
    const a = working[Math.floor(r() * working.length)];
    const [title, resolution] = FAULTS[Math.floor(r() * FAULTS.length)];
    const deviceDown = r() < 0.7;
    const priority: WorkOrderPriority = suggestedPriority(a.criticality, deviceDown);
    const reportedAt = new Date(now - (5 + r() * 85) * 24 * H);
    const startedAt = new Date(reportedAt.getTime() + (0.5 + r() * (priority === "URGENT" ? 5 : 60)) * H);
    const completedAt = new Date(startedAt.getTime() + (1 + r() * 40) * H);
    const closedAt = new Date(completedAt.getTime() + (2 + r() * 30) * H);
    const reporter = reporters[i % Math.max(1, reporters.length)];
    const cost = r() < 0.5 ? String(Math.round(500 + r() * 9500)) : null;
    const [ev] = await db.insert(maintenanceEvents).values({
      assetId: a.id, type: "CORRECTIVE", status: "COMPLETED", scheduledDate: reportedAt.toISOString().slice(0, 10), completedDate: completedAt.toISOString().slice(0, 10),
      performedBy: tech?.name ?? "Biomedical technician", cost, currency: cost ? "EGP" : null,
      downtimeHours: deviceDown ? Math.round(((completedAt.getTime() - reportedAt.getTime()) / H) * 10) / 10 : null, findings: `${title}. ${resolution}`,
    }).returning({ id: maintenanceEvents.id });
    const [wo] = await db.insert(workOrders).values({
      number: nextNo(), assetId: a.id, facilityId: a.facilityId, type: "CORRECTIVE", priority, status: "CLOSED", title, deviceDown,
      reportedById: reporter?.id ?? null, reportedByName: reporter?.name ?? "Ward nurse", assignedToId: tech?.id ?? null,
      reportedAt, dueAt: responseDue(reportedAt, priority), assignedAt: new Date(reportedAt.getTime() + 0.3 * H), startedAt, completedAt, closedAt,
      downtimeStart: deviceDown ? reportedAt : null, downtimeEnd: deviceDown ? completedAt : null,
      resolution, rootCause: r() < 0.5 ? "Wear" : "User handling", laborHours: Math.round((1 + r() * 6) * 4) / 4, cost, currency: cost ? "EGP" : null,
      maintenanceEventId: ev.id,
    }).returning({ id: workOrders.id });
    log.push(
      { entityType: "work_order", entityId: wo.id, action: "reported", summary: `Reported: ${title}`, actor: reporter?.name ?? null, at: reportedAt },
      { entityType: "work_order", entityId: wo.id, action: "completed", summary: `Completed: ${resolution}`, actor: tech?.name ?? null, at: completedAt },
      { entityType: "work_order", entityId: wo.id, action: "closed", summary: "Signed off", actor: lead?.name ?? admin?.name ?? null, at: closedAt },
    );
    created++;
  }

  // Open jobs for the devices that are down today.
  let waiting = 0;
  for (const [i, a] of down.entries()) {
    // The asset seed notes some faults ("Cracked display, awaiting part"); use them as the report when present.
    const noted = a.notes && !a.notes.startsWith("Demo placement") ? a.notes.split(/ — |, awaiting/)[0]?.trim() : undefined;
    const title = noted || FAULTS[i % FAULTS.length][0];
    const priority = suggestedPriority(a.criticality, true);
    const reportedAt = new Date(now - (2 + r() * 120) * H);
    const working = a.status === "UNDER_MAINTENANCE";
    const status = working ? (i % 3 === 0 ? "ON_HOLD" : "IN_PROGRESS") : waiting++ % 2 === 0 ? "OPEN" : "ASSIGNED";
    const assigned = status !== "OPEN" && tech;
    const reporter = reporters[i % Math.max(1, reporters.length)];
    const [wo] = await db.insert(workOrders).values({
      number: nextNo(), assetId: a.id, facilityId: a.facilityId, type: "CORRECTIVE", priority, status, title, deviceDown: true,
      reportedById: reporter?.id ?? null, reportedByName: reporter?.name ?? "Ward nurse", reporterContact: "Ext. 2" + String(100 + (i % 800)),
      assignedToId: assigned ? tech.id : null, reportedAt, dueAt: responseDue(reportedAt, priority),
      assignedAt: assigned ? new Date(reportedAt.getTime() + 0.5 * H) : null,
      startedAt: working ? new Date(reportedAt.getTime() + 1.5 * H) : null,
      downtimeStart: reportedAt, holdReason: status === "ON_HOLD" ? HOLD[i % HOLD.length] : null,
    }).returning({ id: workOrders.id });
    log.push({ entityType: "work_order", entityId: wo.id, action: "reported", summary: `Reported: ${title} (device out of use)`, actor: reporter?.name ?? null, at: reportedAt });
    if (assigned) log.push({ entityType: "work_order", entityId: wo.id, action: "assigned", summary: `Assigned to ${tech.name}`, actor: lead?.name ?? null, at: new Date(reportedAt.getTime() + 0.5 * H) });
    created++;
  }
  for (let i = 0; i < log.length; i += 500) await db.insert(activityLog).values(log.slice(i, i + 500));
  console.log(`  workorders: ${created} created (${down.length} open for devices that are down)`);
}
