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
  activityLog, assets, deviceTypes, disposals, facilities, maintenanceEvents, partTransactions, recallAssets, recalls, serviceContractAssets, serviceContracts,
  spareParts, suppliers, users, workOrders,
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
  // The CAD fit-out (La Plaza, a new hospital) has no maintenance schedule yet: plan each device's first PPM visit,
  // some already overdue, so the 3D "overdue maintenance" layer and the planner have something to show (demo data).
  const unplanned = await db.select({ id: assets.id }).from(assets)
    .where(and(sql`${assets.status} in ('IN_SERVICE', 'INSTALLED')`, sql`not exists (select 1 from maintenance_events m where m.asset_id = ${assets.id})`));
  if (unplanned.length) {
    const rnd = rng(7);
    const visits = unplanned.map((b) => ({
      assetId: b.id, type: "PPM" as const, status: "SCHEDULED" as const,
      // −45 … +120 days: about a quarter already overdue.
      scheduledDate: new Date(Date.now() + Math.round(-45 + rnd() * 165) * 86_400_000).toISOString().slice(0, 10),
    }));
    for (let i = 0; i < visits.length; i += 500) await db.insert(maintenanceEvents).values(visits.slice(i, i + 500));
  }

  // The demo launcher seeds on every start: once demo jobs or contracts exist, don't add them again (contract numbers
  // are unique, so a second run would fail and stop the app).
  const existing = await db.execute<{ n: number }>(sql`select ((select count(*) from service_contracts) + (select count(*) from work_orders))::int as n`);
  if (Number(existing.rows[0]?.n ?? 0) > 0) { console.log("  workorders: demo jobs and contracts already loaded, skipped"); return; }

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
  // Spare parts in the main hospital's store; some used on closed jobs, a few low or out of stock.
  let parts = 0, recallCount = 0;
  if (fac) {
    const typeId = async (code: string) => (await db.select({ id: deviceTypes.id }).from(deviceTypes).where(eq(deviceTypes.code, code)))[0]?.id ?? null;
    const PARTS: [string, string, string | null, string, number, number, number][] = [
      ["MS-SPO2-A01", "SpO2 sensor, adult, reusable", "MON-PAT-HIGH", "Shelf A1", 650, 6, 3],
      ["MS-NIBP-CUF-M", "NIBP cuff, adult medium", "MON-PAT-MID", "Shelf A1", 420, 12, 5],
      ["MS-ECG-5L", "ECG trunk cable, 5 lead", "MON-PAT-HIGH", "Shelf A2", 1800, 2, 3],
      ["VN-O2CELL", "Oxygen sensor cell", "LIF-VEN-ICU", "Shelf B1", 3900, 1, 2],
      ["VN-EXP-VALVE", "Expiratory valve assembly", "LIF-VEN-ICU", "Shelf B1", 7600, 3, 1],
      ["VN-FLT-HEPA", "Bacterial/viral filter (box of 50)", "LIF-VEN-ICU", "Shelf B2", 2100, 0, 2],
      ["IP-BAT-LI", "Infusion pump battery pack", "INF-PMP-VOL", "Shelf C1", 1450, 8, 4],
      ["IP-DOOR-ASSY", "Pump door assembly", "INF-PMP-VOL", "Shelf C1", 980, 2, 1],
      ["DF-PADS-AD", "Defibrillator pads, adult", "LIF-DEF-AED", "Shelf D1", 760, 10, 6],
      ["DF-BAT", "Defibrillator battery", "LIF-DEF-MAN", "Shelf D1", 5200, 1, 1],
      ["GN-FUSE-T2A", "Fuse T2A 250V (pack of 10)", null, "Drawer E", 45, 40, 10],
      ["GN-MAINS-C13", "Mains lead IEC C13, 2 m", null, "Drawer E", 120, 15, 5],
    ];
    const issued = await db.select({ id: workOrders.id }).from(workOrders).where(and(eq(workOrders.status, "CLOSED"), eq(workOrders.facilityId, fac.id))).limit(12);
    for (const [k, [pn, name, code, loc, cost, stock, min]] of PARTS.entries()) {
      const [part] = await db.insert(spareParts).values({
        facilityId: fac.id, partNumber: pn, name, deviceTypeId: code ? await typeId(code) : null, location: `BME store, ${loc}`,
        unitCost: String(cost), currency: "EGP", stockQty: stock, minQty: min, supplierId: sups[k % Math.max(1, sups.length)]?.id ?? null,
      }).returning({ id: spareParts.id });
      const txns: (typeof partTransactions.$inferInsert)[] = [{ partId: part.id, kind: "RECEIPT", quantity: stock + 2, unitCost: String(cost), note: "Opening stock", actor: lead?.name ?? null, at: new Date(now - 100 * 24 * H) }];
      const job = issued[k % Math.max(1, issued.length)];
      if (job) txns.push({ partId: part.id, kind: "ISSUE", quantity: -2, unitCost: String(cost), workOrderId: job.id, actor: tech?.name ?? null, at: new Date(now - 20 * 24 * H) });
      else txns[0].quantity = stock;
      await db.insert(partTransactions).values(txns);
      parts++;
    }

    // Recalls: one urgent notice on the commonest ventilator model (half dealt with), one advisory on infusion pumps.
    const commonest = async (prefix: string) => (await db.select({ man: assets.manufacturer, model: assets.model, typeId: assets.deviceTypeId, n: sql<number>`count(*)::int` })
      .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(like(deviceTypes.code, `${prefix}-%`), sql`${assets.model} is not null`, sql`${assets.status} <> 'DISPOSED'`))
      .groupBy(assets.manufacturer, assets.model, assets.deviceTypeId).orderBy(sql`count(*) desc`).limit(1))[0];
    const notices = [
      { prefix: "LIF-VEN", title: "Risk of unexpected shutdown after battery calibration", action: "SOFTWARE_UPDATE" as const, urgent: true, done: 0.5, ref: "FSN-2026-014" },
      { prefix: "INF-PMP", title: "Updated cleaning instructions for the door mechanism", action: "ADVISORY" as const, urgent: false, done: 0, ref: "FSN-2026-022" },
    ];
    for (const nt of notices) {
      const m = await commonest(nt.prefix);
      if (!m) continue;
      const hits = await db.select({ id: assets.id }).from(assets)
        .where(and(eq(assets.deviceTypeId, m.typeId), sql`${assets.manufacturer} is not distinct from ${m.man}`, eq(assets.model, m.model!), sql`${assets.status} <> 'DISPOSED'`));
      const [rc] = await db.insert(recalls).values({
        number: `FSCA-${new Date(now).getFullYear()}-${String(++recallCount).padStart(4, "0")}`, reference: nt.ref, source: "Manufacturer",
        title: nt.title, description: `${m.man ?? "The manufacturer"} has issued a field safety notice for ${m.model}. Follow the attached instructions.`,
        manufacturer: m.man, deviceTypeId: m.typeId, modelPattern: m.model, action: nt.action, urgent: nt.urgent, issuedDate: shift(-12), dueDate: shift(18),
      }).returning({ id: recalls.id });
      await db.insert(recallAssets).values(hits.map((h, j) => {
        const done = j < Math.floor(hits.length * nt.done);
        return { recallId: rc.id, assetId: h.id, status: done ? "ACTIONED" as const : "PENDING" as const, actionedAt: done ? new Date(now - 3 * 24 * H) : null, note: done ? "Software updated by vendor engineer" : null };
      }));
    }
  }
  // Disposals: one finished last month, one waiting for the director (through the approvals engine).
  let disposalsMade = 0;
  const [oldest] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets)
    .where(and(eq(assets.status, "IN_SERVICE"), sql`${assets.installDate} is not null`)).orderBy(assets.installDate).limit(1);
  const [broken] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets)
    .where(eq(assets.status, "OUT_OF_SERVICE")).orderBy(assets.id).limit(1);
  if (oldest && lead) {
    await db.insert(disposals).values({
      number: `DSP-${year}-0001`, assetId: oldest.id, facilityId: oldest.facilityId, reason: "END_OF_LIFE", method: "TRADE_IN",
      justification: "Past its service life; the manufacturer no longer supplies parts. Traded in against the replacement.",
      status: "COMPLETED", requestedById: lead.id, requestedByName: lead.name, decidedAt: new Date(now - 40 * 24 * H),
      disposedOn: shift(-30), proceeds: "15000", currency: "EGP", certificateRef: "Condemnation committee minutes 2026/07",
    });
    await db.update(assets).set({ status: "DISPOSED", condition: "CONDEMNED" }).where(eq(assets.id, oldest.id));
    disposalsMade++;
  }
  if (broken && lead) {
    const [d] = await db.insert(disposals).values({
      number: `DSP-${year}-0002`, assetId: broken.id, facilityId: broken.facilityId, reason: "BEYOND_REPAIR", method: "SCRAP",
      justification: "Main board failed twice this year; the vendor's repair quote is 70 % of a new unit and parts lead time is 12 weeks.",
      status: "PENDING_APPROVAL", requestedById: lead.id, requestedByName: lead.name,
    }).returning({ id: disposals.id });
    const [actor] = await db.select({ id: users.id, name: users.name, role: users.role, allFacilities: users.allFacilities }).from(users).where(eq(users.id, lead.id));
    try {
      const { startApproval } = await import("../../src/lib/approvals/server");
      await startApproval({ entity: "DISPOSAL", entityId: d.id, title: `Dispose of ${broken.tag} (DSP-${year}-0002)`, href: `/assets/disposals/${d.id}`, facilityId: broken.facilityId }, actor);
    } catch (e) {
      await db.update(disposals).set({ status: "DRAFT" }).where(eq(disposals.id, d.id));
      console.warn("  workorders: disposal left as draft —", e instanceof Error ? e.message : e);
    }
    disposalsMade++;
  }
  for (let i = 0; i < log.length; i += 500) await db.insert(activityLog).values(log.slice(i, i + 500));
  console.log(`  workorders: ${parts} spare parts, ${recallCount} recalls, ${disposalsMade} disposals`);
  console.log(`  workorders: ${created} created (${down.length} open for devices that are down, ${visits.length} PPM jobs with checklists), ${contracts} service contracts`);
}
