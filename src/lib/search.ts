import "server-only";
/**
 * Global search (wave 5): one box across equipment, device types, makes and models, rooms and departments, work
 * orders, suppliers, projects, purchase orders and BOQs. Each group respects the user's permissions and hospitals.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { assets, boqs, buildings, departments, deviceModels, deviceTypes, facilities, floors, projects, purchaseOrders, rooms, suppliers, workOrders } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { facilityScope, type CurrentUser } from "@/lib/auth/session";

export type SearchHit = { href: string; title: string; detail?: string };
export type SearchGroup = { key: string; label: string; hits: SearchHit[]; more?: string };

const LIMIT = 8;
const esc = (q: string) => `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;

export async function globalSearch(q: string, me: CurrentUser): Promise<SearchGroup[]> {
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return [];
  const like = esc(term);
  const scope = await facilityScope(me);
  const inScope = (col: Parameters<typeof inArray>[0]): SQL | undefined => (scope === null ? undefined : scope.length ? inArray(col, scope) : sql`false`);
  const orNull = (col: Parameters<typeof inArray>[0]): SQL | undefined => (scope === null ? undefined : scope.length ? or(inArray(col, scope), isNull(col)) : isNull(col));
  const jobs: Promise<SearchGroup | null>[] = [];
  const enc = encodeURIComponent(term);

  if (can(me.role, "assets.view")) {
    jobs.push(db.select({ id: assets.id, tag: assets.assetTag, type: deviceTypes.name, maker: assets.manufacturer, model: assets.model, serial: assets.serialNumber, fac: facilities.code, status: assets.status })
      .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .where(and(inScope(assets.facilityId), or(ilike(assets.assetTag, like), ilike(assets.serialNumber, like), ilike(assets.model, like), ilike(assets.manufacturer, like),
        sql`array_to_string(${assets.tags}, ' ') ilike ${like}`)))
      .orderBy(asc(assets.assetTag)).limit(LIMIT + 1)
      .then((r) => ({ key: "assets", label: "Equipment", more: r.length > LIMIT ? `/assets?q=${enc}` : undefined,
        hits: r.slice(0, LIMIT).map((a) => ({ href: `/assets/${a.id}`, title: `${a.tag} · ${a.type}`, detail: [a.maker, a.model, a.serial && `SN ${a.serial}`, a.fac, a.status === "DISPOSED" ? "disposed" : null].filter(Boolean).join(" · ") })) })));
    jobs.push(db.select({ code: deviceTypes.code, name: deviceTypes.name, level: deviceTypes.level }).from(deviceTypes)
      .where(or(ilike(deviceTypes.name, like), ilike(deviceTypes.code, like), ilike(deviceTypes.nameAr, like))).orderBy(asc(deviceTypes.level), asc(deviceTypes.name)).limit(LIMIT)
      .then((r) => ({ key: "types", label: "Device types", hits: r.map((t) => ({ href: `/catalogue/${t.code}`, title: t.name, detail: `${t.code}${t.level < 3 ? (t.level === 1 ? " · category" : " · group") : ""}` })) })));
    jobs.push(db.select({ id: deviceModels.id, maker: deviceModels.manufacturer, model: deviceModels.model, type: deviceTypes.name }).from(deviceModels)
      .innerJoin(deviceTypes, eq(deviceTypes.id, deviceModels.deviceTypeId))
      .where(or(ilike(deviceModels.model, like), ilike(deviceModels.manufacturer, like), sql`${deviceModels.manufacturer} || ' ' || ${deviceModels.model} ilike ${like}`))
      .orderBy(asc(deviceModels.manufacturer), asc(deviceModels.model)).limit(LIMIT)
      .then((r) => ({ key: "models", label: "Makes and models", hits: r.map((m) => ({ href: `/catalogue/models/${m.id}`, title: `${m.maker} ${m.model}`, detail: m.type })) })));
    jobs.push(db.select({ id: rooms.id, code: rooms.code, name: rooms.name, floor: floors.name, floorId: floors.id, fac: facilities.code }).from(rooms)
      .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).innerJoin(facilities, eq(facilities.id, buildings.facilityId))
      .where(and(inScope(buildings.facilityId), or(ilike(rooms.name, like), ilike(rooms.code, like)))).orderBy(asc(rooms.code)).limit(LIMIT)
      .then((r) => ({ key: "rooms", label: "Rooms", hits: r.map((x) => ({ href: `/assets/map?floorId=${x.floorId}&roomId=${x.id}`, title: `${x.name} · ${x.code}`, detail: `${x.floor} · ${x.fac}` })) })));
    jobs.push(db.select({ id: departments.id, name: departments.name, code: departments.code, fac: facilities.code }).from(departments)
      .innerJoin(facilities, eq(facilities.id, departments.facilityId))
      .where(and(inScope(departments.facilityId), or(ilike(departments.name, like), ilike(departments.code, like), ilike(departments.nameAr, like)))).orderBy(asc(departments.name)).limit(LIMIT)
      .then((r) => ({ key: "departments", label: "Departments", hits: r.map((d) => ({ href: `/assets?departmentId=${d.id}`, title: d.name, detail: `${d.code} · ${d.fac}` })) })));
    jobs.push(db.select({ id: workOrders.id, number: workOrders.number, title: workOrders.title, status: workOrders.status }).from(workOrders)
      .where(and(inScope(workOrders.facilityId), or(ilike(workOrders.number, like), ilike(workOrders.title, like)))).orderBy(desc(workOrders.id)).limit(LIMIT)
      .then((r) => ({ key: "workorders", label: "Work orders", hits: r.map((w) => ({ href: `/assets/work-orders/${w.id}`, title: `${w.number} · ${w.title}`, detail: w.status.replace(/_/g, " ").toLowerCase() })) })));
  }
  if (can(me.role, "procurement.view")) {
    jobs.push(db.select({ id: suppliers.id, name: suppliers.name, contact: suppliers.contactName }).from(suppliers)
      .where(or(ilike(suppliers.name, like), ilike(suppliers.contactName, like))).orderBy(asc(suppliers.name)).limit(LIMIT)
      .then((r) => ({ key: "suppliers", label: "Suppliers", hits: r.map((s) => ({ href: `/procurement/suppliers/${s.id}`, title: s.name, detail: s.contact ?? undefined })) })));
    jobs.push(db.select({ id: projects.id, code: projects.code, title: projects.title }).from(projects)
      .where(and(orNull(projects.facilityId), or(ilike(projects.code, like), ilike(projects.title, like)))).orderBy(desc(projects.id)).limit(LIMIT)
      .then((r) => ({ key: "projects", label: "Projects and tenders", hits: r.map((p) => ({ href: `/procurement/${p.id}`, title: `${p.code} · ${p.title}` })) })));
    jobs.push(db.select({ id: purchaseOrders.id, number: purchaseOrders.number, supplier: suppliers.name, status: purchaseOrders.status }).from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(and(orNull(purchaseOrders.facilityId), or(ilike(purchaseOrders.number, like), ilike(suppliers.name, like)))).orderBy(desc(purchaseOrders.id)).limit(LIMIT)
      .then((r) => ({ key: "pos", label: "Purchase orders", hits: r.map((p) => ({ href: `/procurement/purchase-orders/${p.id}`, title: `${p.number} · ${p.supplier}`, detail: p.status.replace(/_/g, " ").toLowerCase() })) })));
  }
  if (can(me.role, "boq.view")) {
    jobs.push(db.select({ id: boqs.id, name: boqs.name, version: boqs.version, status: boqs.status }).from(boqs)
      .where(and(orNull(boqs.facilityId), ilike(boqs.name, like))).orderBy(desc(boqs.id)).limit(LIMIT)
      .then((r) => ({ key: "boqs", label: "BOQs", hits: r.map((b) => ({ href: `/boq/${b.id}`, title: `${b.name} v${b.version}`, detail: b.status.replace(/_/g, " ").toLowerCase() })) })));
  }
  return (await Promise.all(jobs)).filter((g): g is SearchGroup => !!g && g.hits.length > 0);
}
