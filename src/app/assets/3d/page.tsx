import { asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { drawingSymbols, assets, buildings, departments, deviceModels, deviceTypes, siteRequirements, facilities, floorCad, floors, liftCores, patientFlows, recallAssets, recalls, documents, rooms, routeFixes, twinNotes, twinTours, twinViews, userFacilities, users } from "@/db/schema";
import { noteOf } from "@/lib/assets/twin-notes";
import { equipmentNames, loadFlow } from "@/lib/flows/server";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { DEPARTMENT_PALETTE, rectPoly } from "@/components/assets/twin/geometry";
import { TwinView } from "@/components/assets/twin/twin-view";
import { listPlans } from "@/lib/assets/commissioning-server";
import type { TwinData } from "@/components/assets/twin/types";
import { can } from "@/lib/auth/permissions";
import { myDepartments } from "@/lib/auth/departments";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { twinLive } from "@/lib/assets/twin-live";
import { plansForFacility } from "@/lib/assets/plan-installed-server";
import { sizesFor } from "@/lib/assets/dimensions-server";
import { checkedRooms, loadStandards } from "@/lib/assets/room-standards-server";
import { libraryFor } from "@/lib/assets/equipment-library-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "3D view" };

/** Floor-to-floor height when a floor has no stored elevation (La Plaza: 5 m). */
const FLOOR_TO_FLOOR_M = 5;

export default async function ThreeDPage({ searchParams }: { searchParams: Promise<{ facilityId?: string; flow?: string; recall?: string; commissioning?: string }> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name, code: facilities.code }).from(facilities)
    .where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  if (!facs.length) {
    const canAdd = can(me.role, "facilities.edit") && scope === null;
    return (<><PageHeader title="3D view" /><EmptyState title={scope?.length === 0 ? "No facility linked to your account" : "No facility yet"}
      action={canAdd ? <LinkButton href="/facilities/new" variant="primary">Add a facility</LinkButton> : undefined}>
      {scope?.length === 0 ? "Ask an administrator to give you access to a facility." : "Add a hospital with its floors and rooms to see it in 3D."}</EmptyState></>);
  }
  // Default: the facility imported from CAD, else the first one.
  const withCad = await db.selectDistinct({ id: buildings.facilityId }).from(floorCad)
    .innerJoin(floors, eq(floors.id, floorCad.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId));
  const wanted = Number(sp.facilityId);
  if (Number.isInteger(wanted) && wanted > 0) await requireFacilityAccess(wanted, me);
  const facility = facs.find((f) => f.id === wanted) ?? facs.find((f) => withCad.some((w) => w.id === f.id)) ?? facs[0];

  const floorRows = await db.select({ f: floors, buildingName: buildings.name, hasCad: sql<boolean>`exists(select 1 from ${floorCad} where ${floorCad.floorId} = ${floors.id})` })
    .from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facility.id)).orderBy(asc(floors.level));
  const floorIds = floorRows.map((r) => r.f.id);
  const roomRows = floorIds.length ? await db.select().from(rooms).where(inArray(rooms.floorId, floorIds)) : [];
  const deptRows = await db.select({ id: departments.id, name: departments.name, code: departments.code, typeCode: departments.departmentTypeCode }).from(departments)
    .where(eq(departments.facilityId, facility.id)).orderBy(asc(departments.name));

  const group = alias(deviceTypes, "grp"), cat = alias(deviceTypes, "cat");
  const assetRows = await db.select({
    id: assets.id, tag: assets.assetTag, deviceType: deviceTypes.name, typeCode: deviceTypes.code, category: sql<string>`coalesce(${cat.name}, ${group.name}, ${deviceTypes.name})`,
    categoryCode: sql<string>`coalesce(${cat.code}, ${group.code}, ${deviceTypes.code})`, groupCode: sql<string | null>`case when ${cat.code} is null then null else ${group.code} end`, status: assets.status, criticality: assets.criticality,
    roomId: assets.roomId, posX: assets.posX, posY: assets.posY, manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(group, eq(group.id, deviceTypes.parentId)).leftJoin(cat, eq(cat.id, group.parentId))
    .where(sql`${assets.facilityId} = ${facility.id} and ${assets.status} <> 'DISPOSED'`);
  const sizes = await sizesFor({ facilityId: facility.id });
  // Equipment library (wave 17): clearance zones, connection points and the model's own 3D file.
  const lib = await libraryFor(assetRows);
  const sized = assetRows.map((a) => {
    const z = sizes.get(a.id);
    const key = lib.keyOf.get(a.id);
    return { ...a, dims: z?.dims ?? { l: 0.6, w: 0.5, h: 1 }, rot: z?.rot ?? null, ...(key ? { lib: key } : {}) };
  });

  // Published pathways, plus any version asked for by link (…&flow=12,14: a draft to compare with the published one).
  const asked = (sp.flow ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 6);
  const published = await db.select({ id: patientFlows.id }).from(patientFlows)
    .where(sql`${patientFlows.facilityId} = ${facility.id} and (${patientFlows.status} = 'PUBLISHED'${asked.length ? sql` or ${inArray(patientFlows.id, asked)}` : sql``})`)
    .orderBy(asc(patientFlows.name), asc(patientFlows.version));
  const loaded = (await Promise.all(published.map((p) => loadFlow(p.id)))).filter((f) => f != null);
  const names = await equipmentNames(loaded.flatMap((f) => f.steps.flatMap((s) => s.equipment)));
  const flows = loaded.map((f) => ({ names,
    id: f.flow.id, name: f.flow.name, version: f.flow.version, dailyVolume: f.flow.dailyVolume, arrivalProfile: f.flow.arrivalProfile, status: f.flow.status, kind: f.flow.kind,
    steps: f.steps.map(({ id: _i, ...s }) => { void _i; return s; }), links: f.links.map(({ id: _i, ...l }) => { void _i; return l; }),
  }));

  // Room templates (wave 16, phase 4): each room against the template for its kind, for the 3D tint and room card.
  const templates = new Map((await checkedRooms(facility.id, (await loadStandards()).rules)).filter((c) => c.standardIndex != null && c.state !== "none").map((c) => [c.id, {
    label: c.standard ?? "", index: c.standardIndex!, state: c.state as "ok" | "short" | "unknown",
    short: c.rows.filter((x) => x.state === "short" && x.kind !== "equipment").map((x) => `${x.label}: ${x.have} (${x.need})`),
    missing: c.rows.filter((x) => x.state === "short" && x.kind === "equipment").map((x) => `${x.label}: ${x.have} of ${x.need.replace("≥ ", "")}`),
    unknown: c.rows.filter((x) => x.state === "unknown").map((x) => x.label),
  }]));

  const [brand] = await db.select({ logo: facilities.logo, brandColor: facilities.brandColor }).from(facilities).where(eq(facilities.id, facility.id));
  const data: TwinData = {
    facility: { ...facility, logo: brand?.logo ?? null, brandColor: brand?.brandColor ?? null },
    can: { report: can(me.role, "workorders.report"), move: can(me.role, "assets.move"), maintain: can(me.role, "maintenance.edit"), addAsset: can(me.role, "assets.edit"), editFacility: can(me.role, "facilities.edit"),
      zoneDepartments: me.role === "DEPARTMENT_HEAD" ? [...(await myDepartments(me.id))] : undefined },
    facilities: facs.map((f) => ({ id: f.id, name: f.name })),
    floors: floorRows.map(({ f, buildingName, hasCad }) => ({
      id: f.id, name: floorRows.filter((x) => x.f.level === f.level).length > 1 ? `${buildingName}, ${f.name}` : f.name, level: f.level, buildingName,
      elevation: f.elevation ?? f.level * FLOOR_TO_FLOOR_M, planWidth: f.planWidth, planHeight: f.planHeight,
      // Hand-drawn plans have no scale; 10 units per metre gives the demo grid a believable size.
      unitsPerMetre: f.unitsPerMetre ?? 10, hasCad: Boolean(hasCad),
    })),
    rooms: roomRows.filter((r) => r.type !== "CORRIDOR" || r.polygon).map((r) => ({
      id: r.id, floorId: r.floorId, code: r.code, name: r.name, type: r.type, departmentId: r.departmentId, zone: r.zone, workshop: r.workshop,
      site: { ceilingM: r.ceilingM, doorWidthM: r.doorWidthM, doorHeightM: r.doorHeightM, floorLoadKgM2: r.floorLoadKgM2, services: r.services ?? null },
      poly: r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h),
      outlineSource: r.outlineSource, verified: r.verifiedAt != null, template: templates.get(r.id) ?? null,
    })),
    departments: deptRows.map((d, i) => ({ ...d, color: DEPARTMENT_PALETTE[i % DEPARTMENT_PALETTE.length] })),
    assets: sized.filter((a) => a.roomId != null),
    unplaced: sized.filter((a) => a.roomId == null),
    flows,
    fixes: floorIds.length ? (await db.select().from(routeFixes).where(inArray(routeFixes.floorId, floorIds)))
      .map((f) => ({ id: f.id, floorId: f.floorId, kind: f.kind, x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, note: f.note, by: f.createdByName })) : [],
    siteModels: (await db.select({ s: siteRequirements, manufacturer: deviceModels.manufacturer, model: deviceModels.model, typeName: deviceTypes.name }).from(siteRequirements)
      .innerJoin(deviceModels, eq(deviceModels.id, siteRequirements.modelId)).innerJoin(deviceTypes, eq(deviceTypes.id, deviceModels.deviceTypeId))
      .where(eq(deviceModels.active, true)).orderBy(asc(deviceModels.manufacturer), asc(deviceModels.model)))
      .map(({ s, manufacturer, model, typeName }) => ({ id: s.modelId, name: `${manufacturer} ${model}`, typeName, typical: !!s.source?.toLowerCase().startsWith("typical"), verified: s.verified,
        req: { lengthM: s.lengthM, widthM: s.widthM, heightM: s.heightM, clearanceM: s.clearanceM, minRoomLengthM: s.minRoomLengthM, minRoomWidthM: s.minRoomWidthM, minAreaM2: s.minAreaM2, minCeilingM: s.minCeilingM,
          doorWidthM: s.doorWidthM, doorHeightM: s.doorHeightM, weightKg: s.weightKg, powerKva: s.powerKva, heatKw: s.heatKw, chilledWater: s.chilledWater, quenchPipe: s.quenchPipe, rfShield: s.rfShield, leadLined: s.leadLined,
          fringeAlongM: s.fringeAlongM, fringeAcrossM: s.fringeAcrossM } })),
    // Things drawn in the plans (not gas outlets): placed where the drawing shows them, before illustrative room kits.
    symbols: floorIds.length ? (await db.select({ floorId: drawingSymbols.floorId, roomId: drawingSymbols.roomId, kind: drawingSymbols.kind, code: drawingSymbols.code, label: drawingSymbols.label, x: drawingSymbols.x, y: drawingSymbols.y, rot: drawingSymbols.rot })
      .from(drawingSymbols).where(sql`${inArray(drawingSymbols.floorId, floorIds)} and ${drawingSymbols.kind} <> 'outlet'`)) : [],
    library: lib.library,
    lifts: (await db.select().from(liftCores).where(eq(liftCores.facilityId, facility.id)).orderBy(asc(liftCores.name)))
      .map((l) => ({ id: l.id, name: l.name, kind: l.kind, inferred: l.inferred, cars: l.cars, waitSeconds: l.waitSeconds, waitByHour: l.waitByHour ?? null, stops: l.stops.filter((st) => floorIds.includes(st.floorId)) })),
  };
  const views = await db.select().from(twinViews)
    .where(sql`${twinViews.facilityId} = ${facility.id} and (${twinViews.shared} or ${twinViews.createdById} = ${me.id})`).orderBy(asc(twinViews.name));
  // Notes: open ones, and those closed in the last 30 days. People who can see this hospital, for "For".
  const notes = (await db.select().from(twinNotes)
    .where(sql`${twinNotes.facilityId} = ${facility.id} and (${twinNotes.status} = 'OPEN' or ${twinNotes.closedAt} > now() - interval '30 days')`)
    .orderBy(sql`${twinNotes.createdAt} desc`).limit(500)).map(noteOf);
  if (notes.length) {
    const photos = await db.select({ id: documents.id, entityId: documents.entityId, url: documents.url, name: documents.fileName }).from(documents)
      .where(sql`${documents.entityType} = 'twin_note' and ${inArray(documents.entityId, notes.map((n) => n.id))}`);
    for (const n of notes) n.photos = photos.filter((p) => p.entityId === n.id).map(({ id, url, name }) => ({ id, url, name }));
  }
  const people = await db.select({ id: users.id, name: users.name }).from(users)
    .where(sql`${users.active} and (${users.allFacilities} or ${users.role} = 'ADMIN' or exists(select 1 from ${userFacilities} uf where uf.user_id = ${users.id} and uf.facility_id = ${facility.id}))`)
    .orderBy(asc(users.name));
  const tours = (await db.select().from(twinTours)
    .where(sql`${twinTours.facilityId} = ${facility.id} and (${twinTours.shared} or ${twinTours.createdById} = ${me.id})`).orderBy(asc(twinTours.name)))
    .map((t) => ({ id: t.id, name: t.name, stops: t.stops, shared: t.shared, mine: t.createdById === me.id, by: t.createdByName }));
  return <TwinView data={data} live={await twinLive(facility.id)} notes={notes} tours={tours} people={people} me={{ id: me.id, canEditAssets: can(me.role, "assets.edit") }}
    views={views.map((v) => ({ id: v.id, name: v.name, state: v.state, shared: v.shared, mine: v.createdById === me.id, by: v.createdByName, render: v.render ?? null }))}
    canManageViews={can(me.role, "users.manage")}
    plans={can(me.role, "boq.view") ? await plansForFacility(facility.id) : []}
    spotlight={await recallSpotlight(Number(sp.recall), facility.id)}
    commissioning={{ plans: (await listPlans([facility.id])).map((p) => ({ id: p.id, name: p.name })), initial: Number(sp.commissioning) || null }} />;
}

/** A recall's pending devices in this hospital (…&recall=<id>), to pick out in the model. */
async function recallSpotlight(recallId: number, facilityId: number) {
  if (!Number.isInteger(recallId) || recallId <= 0) return null;
  const [r] = await db.select({ number: recalls.number, title: recalls.title }).from(recalls).where(eq(recalls.id, recallId));
  if (!r) return null;
  const ids = (await db.select({ id: assets.id }).from(recallAssets).innerJoin(assets, eq(assets.id, recallAssets.assetId))
    .where(sql`${recallAssets.recallId} = ${recallId} and ${recallAssets.status} = 'PENDING' and ${assets.facilityId} = ${facilityId}`)).map((x) => x.id);
  return { ids, label: `${r.number}: ${ids.length} pending device${ids.length === 1 ? "" : "s"} highlighted (${r.title}).` };
}
