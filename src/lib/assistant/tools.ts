import "server-only";
/** Runs the assistant's read-only tools for one user, within their permissions and hospitals (wave 13). */
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, boqDepartments, boqLines, boqs, budgetLines, departments, deviceTypes, facilities, offers, projects, purchaseOrders, recallAssets, recalls, rooms, serviceContractAssets, serviceContracts, suppliers, workOrders } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { facilityScope, type CurrentUser } from "@/lib/auth/session";
import { budgetRows, poValues } from "@/lib/procurement/money-server";
import { TOOLS } from "./defs";

type Input = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : undefined);
const n = (v: unknown) => (Number.isInteger(Number(v)) && v !== "" && v != null ? Number(v) : undefined);
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const words = (q: string | undefined) => (q ? q.split(/\s+/).filter(Boolean).slice(0, 6) : []);

export async function runTool(me: CurrentUser, name: string, input: Input): Promise<unknown> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { error: `No tool called ${name}.` };
  if (!can(me.role, def.need)) return { error: "This user may not see that." };
  const scope = await facilityScope(me);
  const inScope = (col: AnyPgColumn, nullable = false): SQL | undefined =>
    scope ? (nullable ? or(isNull(col), inArray(col, scope.length ? scope : [-1])) : inArray(col, scope.length ? scope : [-1])) : undefined;
  const fac = n(input.facility_id);
  if (fac != null && scope && !scope.includes(fac)) return { error: "This user can't see that hospital." };

  switch (name) {
    case "list_facilities":
      return db.select({ id: facilities.id, code: facilities.code, name: facilities.name, city: facilities.city, beds: facilities.totalBeds }).from(facilities)
        .where(scope ? inArray(facilities.id, scope.length ? scope : [-1]) : undefined).orderBy(asc(facilities.id));

    case "search_assets": {
      const conds = words(s(input.query)).map((w) => or(ilike(assets.assetTag, like(w)), ilike(deviceTypes.name, like(w)), ilike(assets.manufacturer, like(w)), ilike(assets.model, like(w)), ilike(assets.serialNumber, like(w))));
      return db.select({ tag: assets.assetTag, type: deviceTypes.name, maker: assets.manufacturer, model: assets.model, serial: assets.serialNumber, status: assets.status, condition: assets.condition,
        hospital: facilities.code, department: departments.name, room: rooms.name, warrantyEnd: assets.warrantyEnd, installed: assets.installDate })
        .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
        .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
        .where(and(inScope(assets.facilityId), fac != null ? eq(assets.facilityId, fac) : undefined, s(input.status) ? sql`${assets.status}::text = ${s(input.status)}` : undefined, ...conds))
        .orderBy(asc(assets.assetTag)).limit(50);
    }

    case "get_asset": {
      const tag = s(input.tag); if (!tag) return { error: "Give an asset tag." };
      const [a] = await db.select({ id: assets.id, tag: assets.assetTag, type: deviceTypes.name, typeCode: deviceTypes.code, maker: assets.manufacturer, model: assets.model, serial: assets.serialNumber,
        status: assets.status, condition: assets.condition, criticality: assets.criticality, hospital: facilities.name, department: departments.name, room: rooms.name,
        purchaseDate: assets.purchaseDate, installDate: assets.installDate, warrantyEnd: assets.warrantyEnd, lifeYears: assets.lifeExpectancyYears, supplier: suppliers.name, notes: assets.notes })
        .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
        .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(suppliers, eq(suppliers.id, assets.supplierId))
        .where(and(sql`lower(${assets.assetTag}) = lower(${tag})`, inScope(assets.facilityId))).limit(1);
      if (!a) return { error: `No device with tag ${tag} that this user can see.` };
      const jobs = await db.select({ number: workOrders.number, type: workOrders.type, status: workOrders.status, priority: workOrders.priority, title: workOrders.title, reported: workOrders.reportedAt, completed: workOrders.completedAt, resolution: workOrders.resolution })
        .from(workOrders).where(eq(workOrders.assetId, a.id)).orderBy(desc(workOrders.reportedAt)).limit(10);
      const { id: _id, ...rest } = a; void _id;
      return { ...rest, link: `/assets/${a.id}`, workOrders: jobs };
    }

    case "open_work_orders":
      return db.select({ number: workOrders.number, priority: workOrders.priority, status: workOrders.status, title: workOrders.title, tag: assets.assetTag, type: deviceTypes.name, hospital: facilities.code,
        deviceDown: workOrders.deviceDown, reported: workOrders.reportedAt, due: workOrders.dueAt })
        .from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, workOrders.facilityId))
        .where(and(notInArray(workOrders.status, ["COMPLETED", "CLOSED", "CANCELLED"]), inScope(workOrders.facilityId), fac != null ? eq(workOrders.facilityId, fac) : undefined))
        .orderBy(sql`case ${workOrders.priority} when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end`, asc(workOrders.reportedAt)).limit(60);

    case "search_device_types": {
      const conds = words(s(input.query)).map((w) => or(ilike(deviceTypes.name, like(w)), ilike(deviceTypes.code, like(w)), ilike(deviceTypes.description, like(w))));
      if (!conds.length) return { error: "Give some words to look for." };
      return db.select({ code: deviceTypes.code, name: deviceTypes.name, description: deviceTypes.description, riskClass: deviceTypes.riskClass, criticality: deviceTypes.criticality,
        lifeYears: deviceTypes.lifeExpectancyYears, ppmMonths: deviceTypes.ppmIntervalMonths, calibration: deviceTypes.requiresCalibration, priceMinUsd: deviceTypes.priceMinUsd, priceMaxUsd: deviceTypes.priceMaxUsd, specParameters: deviceTypes.specTemplate })
        .from(deviceTypes).where(and(...conds)).orderBy(asc(deviceTypes.level), asc(deviceTypes.code)).limit(15);
    }

    case "list_projects": {
      const conds = words(s(input.query)).map((w) => or(ilike(projects.code, like(w)), ilike(projects.title, like(w))));
      return db.select({ code: projects.code, title: projects.title, status: projects.status, hospital: facilities.code, budget: projects.budget, currency: projects.currency, deadline: projects.submissionDeadline })
        .from(projects).leftJoin(facilities, eq(facilities.id, projects.facilityId))
        .where(and(inScope(projects.facilityId, true), s(input.status) ? sql`${projects.status}::text = ${s(input.status)}` : undefined, ...conds)).orderBy(desc(projects.id)).limit(40);
    }

    case "get_project": {
      const code = s(input.code); if (!code) return { error: "Give a project code." };
      const [p] = await db.select().from(projects).where(and(sql`lower(${projects.code}) = lower(${code})`, inScope(projects.facilityId, true))).limit(1);
      if (!p) return { error: `No project ${code} that this user can see.` };
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(offers).where(eq(offers.projectId, p.id));
      const pos = await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, supplier: suppliers.name, currency: purchaseOrders.currency, expected: purchaseOrders.expectedDelivery })
        .from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.projectId, p.id));
      const values = await poValues(pos.map((x) => x.id));
      return { code: p.code, title: p.title, status: p.status, client: p.client, budget: p.budget, currency: p.currency, deadline: p.submissionDeadline, twoEnvelope: p.twoEnvelope, notes: p.notes,
        offers: count, link: `/procurement/${p.id}`, purchaseOrders: pos.map(({ id, ...x }) => ({ ...x, value: values.get(id) ?? 0 })) };
    }

    case "search_suppliers": {
      const conds = words(s(input.query)).map((w) => or(ilike(suppliers.name, like(w)), sql`array_to_string(${suppliers.brands}, ' ') ilike ${like(w)}`));
      return db.select({ name: suppliers.name, type: suppliers.type, country: suppliers.country, brands: suppliers.brands, contact: suppliers.contactName, email: suppliers.email })
        .from(suppliers).where(and(...conds)).orderBy(asc(suppliers.name)).limit(30);
    }

    case "purchase_orders": {
      const sup = s(input.supplier);
      const rows = await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, supplier: suppliers.name, hospital: facilities.code, currency: purchaseOrders.currency,
        issued: purchaseOrders.issueDate, expected: purchaseOrders.expectedDelivery })
        .from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).leftJoin(facilities, eq(facilities.id, purchaseOrders.facilityId))
        .where(and(inScope(purchaseOrders.facilityId, true), s(input.status) ? sql`${purchaseOrders.status}::text = ${s(input.status)!.toUpperCase()}` : undefined, sup ? ilike(suppliers.name, like(sup)) : undefined))
        .orderBy(desc(purchaseOrders.id)).limit(40);
      const values = await poValues(rows.map((r) => r.id));
      return rows.map(({ id, ...r }) => ({ ...r, value: values.get(id) ?? 0, link: `/procurement/purchase-orders/${id}` }));
    }

    case "budget_status": {
      const year = n(input.year) ?? new Date().getFullYear();
      const lines = await db.select().from(budgetLines).where(and(eq(budgetLines.year, year), inScope(budgetLines.facilityId), fac != null ? eq(budgetLines.facilityId, fac) : undefined)).limit(60);
      const codes = new Map((await db.select({ id: facilities.id, code: facilities.code }).from(facilities)).map((f) => [f.id, f.code]));
      return (await budgetRows(lines)).map((r) => ({ hospital: codes.get(r.facilityId), name: r.name, kind: r.kind, year: r.year, currency: r.currency, amount: Number(r.amount), committed: r.committed, spent: r.spent, remaining: r.remaining, usedPct: Math.round(r.pct * 100), level: r.level }));
    }

    case "list_boqs": {
      const conds = words(s(input.query)).map((w) => ilike(boqs.name, like(w)));
      const total = sql<string>`coalesce((select sum(${boqLines.quantity} * coalesce(${boqLines.unitPriceEstimate}, 0)) from ${boqLines} where ${boqLines.boqId} = ${boqs.id}), 0)`;
      const rows = await db.select({ id: boqs.id, name: boqs.name, hospital: facilities.code, status: boqs.status, version: boqs.version, beds: boqs.totalHospitalBeds, currency: boqs.currency, total, updated: boqs.updatedAt })
        .from(boqs).leftJoin(facilities, eq(facilities.id, boqs.facilityId))
        .where(and(inScope(boqs.facilityId, true), s(input.status) ? sql`${boqs.status}::text = ${s(input.status)}` : undefined, ...conds)).orderBy(desc(boqs.updatedAt)).limit(40);
      return rows.map((r) => ({ ...r, total: Math.round(Number(r.total)), link: `/boq/${r.id}` }));
    }

    case "get_boq": {
      const id = n(input.id); if (id == null) return { error: "Give the BOQ id (list_boqs shows it)." };
      const [b] = await db.select().from(boqs).where(and(eq(boqs.id, id), inScope(boqs.facilityId, true))).limit(1);
      if (!b) return { error: `No BOQ ${id} that this user can see.` };
      const depts = await db.select({ id: boqDepartments.id, name: boqDepartments.label, beds: boqDepartments.beds, rooms: boqDepartments.rooms, phase: boqDepartments.phase })
        .from(boqDepartments).where(eq(boqDepartments.boqId, id)).orderBy(asc(boqDepartments.id));
      const dw = words(s(input.department));
      const lines = await db.select({ dept: boqDepartments.label, deptId: boqLines.boqDepartmentId, device: deviceTypes.name, code: deviceTypes.code, tier: boqLines.tier, qty: boqLines.quantity, unit: boqLines.unitPriceEstimate, how: boqLines.calcExplanation })
        .from(boqLines).innerJoin(deviceTypes, eq(deviceTypes.id, boqLines.deviceTypeId)).leftJoin(boqDepartments, eq(boqDepartments.id, boqLines.boqDepartmentId))
        .where(and(eq(boqLines.boqId, id), sql`${boqLines.quantity} > 0`, ...dw.map((w) => ilike(boqDepartments.label, like(w)))));
      const value = (l: (typeof lines)[number]) => l.qty * Number(l.unit ?? 0);
      const byDept = new Map<number | null, number>();
      for (const l of lines) byDept.set(l.deptId, (byDept.get(l.deptId) ?? 0) + value(l));
      return {
        name: b.name, status: b.status, version: b.version, beds: b.totalHospitalBeds, currency: b.currency, contingencyPct: b.contingencyPct, priceTier: b.priceTier,
        targetBudget: b.targetBudget, openingDate: b.openingDate, link: `/boq/${b.id}`,
        total: Math.round(lines.reduce((t, l) => t + value(l), 0)), lineCount: lines.length,
        departments: depts.filter((d) => !dw.length || dw.every((w) => d.name.toLowerCase().includes(w.toLowerCase()))).map(({ id: did, ...d }) => ({ ...d, value: Math.round(byDept.get(did) ?? 0) })),
        largestLines: lines.sort((x, y) => value(y) - value(x)).slice(0, 40).map((l) => ({ department: l.dept, device: l.device, code: l.code, tier: l.tier, quantity: l.qty, unitEstimate: l.unit == null ? null : Number(l.unit), how: l.how })),
      };
    }

    case "service_contracts": {
      const within = n(input.ending_within_days), sup = s(input.supplier);
      const today = new Date().toISOString().slice(0, 10);
      const devices = sql<number>`(select count(*)::int from ${serviceContractAssets} where ${serviceContractAssets.contractId} = ${serviceContracts.id})`;
      const rows = await db.select({ id: serviceContracts.id, number: serviceContracts.number, title: serviceContracts.title, type: serviceContracts.type, supplier: suppliers.name, hospital: facilities.code,
        start: serviceContracts.startDate, end: serviceContracts.endDate, devices, responseHours: serviceContracts.responseHours, repairHours: serviceContracts.repairHours, uptimePct: serviceContracts.uptimePct,
        ppmVisitsPerYear: serviceContracts.ppmVisitsPerYear, includesParts: serviceContracts.includesParts, value: serviceContracts.value, currency: serviceContracts.currency })
        .from(serviceContracts).innerJoin(suppliers, eq(suppliers.id, serviceContracts.supplierId)).innerJoin(facilities, eq(facilities.id, serviceContracts.facilityId))
        .where(and(inScope(serviceContracts.facilityId), fac != null ? eq(serviceContracts.facilityId, fac) : undefined, sup ? ilike(suppliers.name, like(sup)) : undefined,
          within != null ? sql`${serviceContracts.endDate} >= ${today} and ${serviceContracts.endDate} <= (${today}::date + ${within}::int)` : undefined))
        .orderBy(asc(serviceContracts.endDate)).limit(50);
      return rows.map(({ id, ...r }) => ({ ...r, running: r.start <= today && r.end >= today, link: `/assets/contracts/${id}` }));
    }

    case "recalls": {
      const st = s(input.status)?.toUpperCase() ?? "OPEN";
      const conds = words(s(input.query)).map((w) => or(ilike(recalls.title, like(w)), ilike(recalls.manufacturer, like(w)), ilike(recalls.reference, like(w)), ilike(recalls.number, like(w))));
      const rows = await db.select({ id: recalls.id, number: recalls.number, reference: recalls.reference, source: recalls.source, title: recalls.title, maker: recalls.manufacturer, type: deviceTypes.name, model: recalls.modelPattern,
        action: recalls.action, urgent: recalls.urgent, issued: recalls.issuedDate, due: recalls.dueDate, status: recalls.status })
        .from(recalls).leftJoin(deviceTypes, eq(deviceTypes.id, recalls.deviceTypeId))
        .where(and(st === "ANY" ? undefined : sql`${recalls.status}::text = ${st}`, ...conds)).orderBy(desc(recalls.id)).limit(30);
      if (!rows.length) return [];
      const counts = await db.select({ recallId: recallAssets.recallId, status: recallAssets.status, n: sql<number>`count(*)::int` })
        .from(recallAssets).innerJoin(assets, eq(assets.id, recallAssets.assetId))
        .where(and(inArray(recallAssets.recallId, rows.map((r) => r.id)), inScope(assets.facilityId))).groupBy(recallAssets.recallId, recallAssets.status);
      const c = (id: number, status: string) => Number(counts.find((x) => x.recallId === id && x.status === status)?.n ?? 0);
      return rows.map(({ id, ...r }) => ({ ...r, devicesPending: c(id, "PENDING"), devicesActioned: c(id, "ACTIONED"), devicesNotAffected: c(id, "NOT_AFFECTED"), link: `/assets/recalls/${id}` }));
    }
  }
  return { error: "Not available." };
}
