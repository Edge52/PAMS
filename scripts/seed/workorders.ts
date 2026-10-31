/**
 * Demo work orders (wave 3). Runs after the asset and CAD seeds:
 *  - every device the demo left out of service or under maintenance gets an open job (reported, assigned, in progress
 *    or on hold), so the asset status and the work order agree;
 *  - about 40 finished corrective jobs over the last 90 days, with downtime and a maintenance history entry, so the
 *    response, MTTR and downtime figures have something to show.
 * Tolerates missing users (assignments are left empty) and missing assets (nothing to do).
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DB } from "../../src/db";
import {
  activityLog, assets, deviceTypes, facilities, maintenanceEvents, serviceContractAssets, serviceContracts, suppliers, users, workOrders,
} from "../../src/db/schema";
import { responseDue, suggestedPriority, type WorkOrderPriority } from "../../src/lib/assets/work-orders";
import { blankResults, defaultChecklist } from "../../src/lib/assets/checklists";
import { coverOn, type CoverContract } from "../../src/lib/assets/contracts";

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
  const today = new Date(now).toISOString().slice(0, 10);
  const shift = (days: number) => new Date(now + days * 24 * H).toISOString().slice(0, 10);

  // Service contracts: one running, one ending soon, one expired, in the hospital with the most devices.
  const contractsByAsset = new Map<number, CoverContract[]>();
  const sups = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(suppliers.id).limit(3);
  const [fac] = await db.select({ id: facilities.id, n: sql<number>`count(${assets.id})::int` }).from(facilities)
    .innerJoin(assets, eq(assets.facilityId, facilities.id)).groupBy(facilities.id).orderBy(sql`count(${assets.id}) desc`).limit(1);
  let contracts = 0;
  if (sups.length && fac) {
    const plan = [
      { group: "LIF-VEN", title: "Ventilators — full service", type: "FULL_SERVICE" as const, start: shift(-200), end: shift(530), value: 1_450_000, response: 8, visits: 2, parts: true },
      { group: "IMG", title: "Imaging equipment — preventive maintenance", type: "PREVENTIVE" as const, start: shift(-330), end: shift(40), value: 2_300_000, response: 24, visits: 4, parts: false },
      { group: "INF-PMP", title: "Infusion pumps — parts only", type: "PARTS_ONLY" as const, start: shift(-760), end: shift(-30), value: 180_000, response: 72, visits: 1, parts: true },
    ];
    for (const [i, p] of plan.entries()) {
      const sup = sups[i % sups.length];
      const covered = await db.select({ id: assets.id }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
        .where(and(eq(assets.facilityId, fac.id), like(deviceTypes.code, `${p.group}-%`), sql`${assets.status} <> 'DISPOSED'`)).limit(60);
      if (!covered.length) continue;
      const number = `SC-${new Date(now).getFullYear()}-${String(++contracts).padStart(4, "0")}`;
      const [c] = await db.insert(serviceContracts).values({
        number, facilityId: fac.id, supplierId: sup.id, title: p.title, type: p.type, startDate: p.start, endDate: p.end,
        value: String(p.value), currency: "EGP", responseHours: p.response, ppmVisitsPerYear: p.visits, includesParts: p.parts,
        contactName: "Service desk", contactPhone: `+20 2 2${String(4000000 + i * 1111).slice(0, 7)}`, vendorReference: `${sup.name.split(" ")[0].toUpperCase()}-SVC-${100 + i}`,
      }).returning({ id: serviceContracts.id });
      await db.insert(serviceContractAssets).values(covered.map((a) => ({ contractId: c.id, assetId: a.id })));
      for (const a of covered) contractsByAsset.set(a.id, [...(contractsByAsset.get(a.id) ?? []), { id: c.id, number, type: p.type, startDate: p.start, endDate: p.end }]);
    }
  }
  const warranty = new Map((await db.select({ id: assets.id, w: assets.warrantyEnd }).from(assets)).map((a) => [a.id, a.w]));
  const coverFor = (assetId: number, at: Date) => {
    const c = coverOn({ warrantyEnd: warranty.get(assetId) }, contractsByAsset.get(assetId) ?? [], at.toISOString().slice(0, 10));
    return { coverage: c.kind, contractId: c.kind === "CONTRACT" ? c.contract.id : null };
  };
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
      maintenanceEventId: ev.id, ...coverFor(a.id, reportedAt),
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
    const cover = coverFor(a.id, reportedAt);
    const claimed = cover.coverage !== "NONE" && i % 3 === 1;
    const [wo] = await db.insert(workOrders).values({
      number: nextNo(), assetId: a.id, facilityId: a.facilityId, type: "CORRECTIVE", priority, status, title, deviceDown: true,
      reportedById: reporter?.id ?? null, reportedByName: reporter?.name ?? "Ward nurse", reporterContact: "Ext. 2" + String(100 + (i % 800)),
      assignedToId: assigned ? tech.id : null, reportedAt, dueAt: responseDue(reportedAt, priority),
      assignedAt: assigned ? new Date(reportedAt.getTime() + 0.5 * H) : null,
      startedAt: working ? new Date(reportedAt.getTime() + 1.5 * H) : null,
      downtimeStart: reportedAt, holdReason: status === "ON_HOLD" ? HOLD[i % HOLD.length] : null, ...cover,
      claimStatus: claimed ? "SUBMITTED" : "NOT_CLAIMED", claimReference: claimed ? `CLM-${4100 + i}` : null,
    }).returning({ id: workOrders.id });
    log.push({ entityType: "work_order", entityId: wo.id, action: "reported", summary: `Reported: ${title} (device out of use)`, actor: reporter?.name ?? null, at: reportedAt });
    if (assigned) log.push({ entityType: "work_order", entityId: wo.id, action: "assigned", summary: `Assigned to ${tech.name}`, actor: lead?.name ?? null, at: new Date(reportedAt.getTime() + 0.5 * H) });
    created++;
  }
  // PPM jobs with checklists for the scheduled visits of the next 30 days (a dozen, half assigned).
  const grp = alias(deviceTypes, "grp"), cat = alias(deviceTypes, "cat");
  const visits = await db.select({
    id: maintenanceEvents.id, type: maintenanceEvents.type, date: maintenanceEvents.scheduledDate, assetId: assets.id, facilityId: assets.facilityId,
    typeName: deviceTypes.name, code: deviceTypes.code, grpCode: grp.code, catCode: cat.code, calib: deviceTypes.requiresCalibration,
  }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(grp, eq(grp.id, deviceTypes.parentId)).leftJoin(cat, eq(cat.id, grp.parentId))
    .where(and(eq(maintenanceEvents.status, "SCHEDULED"), sql`${maintenanceEvents.scheduledDate} between ${today} and ${shift(30)}`, eq(assets.status, "IN_SERVICE")))
    .orderBy(maintenanceEvents.scheduledDate).limit(12);
  for (const [i, v] of visits.entries()) {
    const at = new Date(now - 2 * H);
    const assign = i % 2 === 0 && tech;
    const [wo] = await db.insert(workOrders).values({
      number: nextNo(), assetId: v.assetId, facilityId: v.facilityId, type: v.type, priority: "NORMAL", status: assign ? "ASSIGNED" : "OPEN",
      title: `Planned preventive maintenance — ${v.typeName}`.slice(0, 160), reportedById: lead?.id ?? null, reportedByName: lead?.name ?? "Biomedical engineering",
      reportedAt: at, dueAt: new Date(`${v.date}T23:59:59Z`), assignedToId: assign ? tech.id : null, assignedAt: assign ? at : null, plannedEventId: v.id,
      checklist: blankResults(defaultChecklist([v.code, v.grpCode, v.catCode], { requiresCalibration: v.calib })), ...coverFor(v.assetId, at),
    }).returning({ id: workOrders.id });
    log.push({ entityType: "work_order", entityId: wo.id, action: "reported", summary: `Raised from the maintenance schedule (visit due ${v.date})`, actor: lead?.name ?? null, at });
    created++;
  }
  for (let i = 0; i < log.length; i += 500) await db.insert(activityLog).values(log.slice(i, i + 500));
  console.log(`  workorders: ${created} created (${down.length} open for devices that are down, ${visits.length} PPM jobs with checklists), ${contracts} service contracts`);
}
