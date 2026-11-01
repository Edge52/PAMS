"use server";
import { parseTags } from "@/lib/assets/tags";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import ExcelJS from "exceljs";
import { db } from "@/db";
import { assets, buildings, departments, deviceTypes, facilities, floors, maintenanceEvents, rooms } from "@/db/schema";
import { createAsset, createAssets, type NewAssetInput } from "@/lib/asset-factory";
import { logActivity } from "@/lib/server-utils";
import { facilityScope, requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { facilityOfAsset, facilityOfEvent, scopeWhere } from "@/lib/assets/access";
import { distribute, expandAllocations, parseSerials, type DistMode } from "@/lib/assets/distribution";
import { ASSET_CONDITIONS, ASSET_STATUSES, MAINTENANCE_STATUSES, MAINTENANCE_TYPES } from "@/lib/assets/filters";
import { firstError, formObject, id, int, isoDate, num, oneOf, reqId, text, type FormState } from "@/lib/assets/forms";
import { MAX_IMPORT_ROWS, mapHeaders, validateRows, type ImportKey, type Lookups, type RowResult, type ValidRow } from "@/lib/assets/import";
import { moveAsset } from "@/lib/assets/mutations";
import { planPpmEvents, maintenanceTypeLabel } from "@/lib/assets/maintenance";
import { todayISO } from "@/lib/format";
import { humanize } from "@/lib/status";

/** Redirects to /forbidden unless the asset's facility is in the user's scope. */
async function requireAssetAccess(assetId: number, me: CurrentUser) {
  await requireFacilityAccess(await facilityOfAsset(assetId), me);
}

/* ── Single asset ── */

const AssetSchema = z.object({
  deviceTypeId: reqId("Device type"), facilityId: reqId("Facility"), departmentId: id(), roomId: id(),
  manufacturer: text(120), model: text(120), serialNumber: text(128),
  status: oneOf("Status", ASSET_STATUSES), condition: oneOf("Condition", ASSET_CONDITIONS),
  purchaseDate: isoDate("Purchase date"), installDate: isoDate("Install date"),
  warrantyMonths: int("Warranty months", 0, 240), warrantyEnd: isoDate("Warranty end"),
  purchaseCost: num("Purchase cost", 0, 1e11), currency: text(3), parentTag: text(48), notes: text(2000),
});

async function serialTaken(serial: string | undefined, exceptId?: number) {
  if (!serial) return null;
  const [r] = await db.select({ id: assets.id, tag: assets.assetTag }).from(assets).where(sql`upper(${assets.serialNumber}) = ${serial.toUpperCase()}`).limit(2);
  return r && r.id !== exceptId ? r.tag : null;
}

async function checkRoom(facilityId: number, roomId?: number, departmentId?: number) {
  if (!roomId) return null;
  const [r] = await db.select({ dept: rooms.departmentId, fac: buildings.facilityId }).from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(rooms.id, roomId));
  if (!r || r.fac !== facilityId) return "That room is not in the chosen facility.";
  if (departmentId && r.dept && r.dept !== departmentId) return "That room belongs to another department — leave the department blank to use the room's.";
  return null;
}

export async function createAssetAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const p = AssetSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireFacilityAccess(d.facilityId, me);
  const roomErr = await checkRoom(d.facilityId, d.roomId, d.departmentId);
  if (roomErr) return { error: roomErr };
  const dup = await serialTaken(d.serialNumber);
  if (dup) return { error: `Serial ${d.serialNumber} is already registered as ${dup}.` };
  if (d.installDate && d.purchaseDate && d.installDate < d.purchaseDate) return { error: "Install date is before the purchase date." };
  let parentAssetId: number | null = null;
  if (d.parentTag) {
    const [par] = await db.select({ id: assets.id, facilityId: assets.facilityId }).from(assets).where(eq(assets.assetTag, d.parentTag.toUpperCase()));
    if (!par) return { error: `No asset has the tag ${d.parentTag}.` };
    if (par.facilityId !== d.facilityId) return { error: `${d.parentTag.toUpperCase()} is in another facility — a component must sit in the same facility as its parent.` };
    parentAssetId = par.id;
  }
  const row = await createAsset({
    deviceTypeId: d.deviceTypeId, facilityId: d.facilityId, departmentId: d.departmentId ?? null, roomId: d.roomId ?? null,
    manufacturer: d.manufacturer ?? null, model: d.model ?? null, serialNumber: d.serialNumber ?? null,
    status: d.status, condition: d.condition, purchaseDate: d.purchaseDate ?? null, installDate: d.installDate ?? null,
    warrantyMonths: d.warrantyMonths ?? null, warrantyEnd: d.warrantyEnd ?? null,
    purchaseCost: d.purchaseCost ?? null, currency: d.purchaseCost != null ? (d.currency ?? "USD").toUpperCase() : null,
    parentAssetId, notes: d.notes ?? null,
  });
  revalidatePath("/assets");
  redirect(`/assets/${row.id}?notice=${encodeURIComponent(`${row.assetTag} registered.`)}`);
}

const EditSchema = AssetSchema.omit({ deviceTypeId: true, facilityId: true, departmentId: true, roomId: true, status: true, condition: true, parentTag: true })
  .extend({ assetId: reqId("Asset"), tags: text(1000) });

export async function updateAssetAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const p = EditSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireAssetAccess(d.assetId, me);
  const dup = await serialTaken(d.serialNumber, d.assetId);
  if (dup) return { error: `Serial ${d.serialNumber} is already registered as ${dup}.` };
  await db.update(assets).set({
    manufacturer: d.manufacturer ?? null, model: d.model ?? null, serialNumber: d.serialNumber ?? null,
    purchaseDate: d.purchaseDate ?? null, installDate: d.installDate ?? null, warrantyEnd: d.warrantyEnd ?? null,
    purchaseCost: d.purchaseCost != null ? String(d.purchaseCost) : null, currency: d.purchaseCost != null ? (d.currency ?? "USD").toUpperCase() : null,
    notes: d.notes ?? null, tags: parseTags(d.tags),
  }).where(eq(assets.id, d.assetId));
  await logActivity("asset", d.assetId, "updated", "Identity and purchase details updated");
  revalidatePath(`/assets/${d.assetId}`);
  redirect(`/assets/${d.assetId}?notice=${encodeURIComponent("Details saved.")}`);
}

/* ── Move / status ── */

const MoveSchema = z.object({ assetId: reqId("Asset"), roomId: id(), departmentId: id(), reason: text(500), movedBy: text(120) });

export async function moveAssetAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.move");
  const p = MoveSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await requireAssetAccess(p.data.assetId, me);
  // "Moved by" is who carried it (a porter, the vendor); the activity log records the signed-in user regardless.
  const res = await moveAsset({ assetId: p.data.assetId, toRoomId: p.data.roomId ?? null, toDepartmentId: p.data.departmentId ?? null,
    reason: p.data.reason ?? null, movedBy: p.data.movedBy ?? me.name });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/assets/${p.data.assetId}`);
  revalidatePath("/assets/map");
  redirect(`/assets/${p.data.assetId}?notice=${encodeURIComponent(res.summary)}`);
}

const StatusSchema = z.object({ assetId: reqId("Asset"), status: oneOf("Status", ASSET_STATUSES), condition: oneOf("Condition", ASSET_CONDITIONS), note: text(500) });

export async function changeStatusAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const p = StatusSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await requireAssetAccess(p.data.assetId, me);
  const [a] = await db.select({ status: assets.status, condition: assets.condition }).from(assets).where(eq(assets.id, p.data.assetId));
  if (!a) return { error: "That asset no longer exists." };
  const status = p.data.status ?? a.status, condition = p.data.condition ?? a.condition;
  if (status === a.status && condition === a.condition) return { error: "Nothing changed — pick a different status or condition." };
  await db.update(assets).set({ status, condition }).where(eq(assets.id, p.data.assetId));
  const parts = [status !== a.status && `status ${humanize(a.status).toLowerCase()} → ${humanize(status).toLowerCase()}`,
    condition !== a.condition && `condition ${humanize(a.condition).toLowerCase()} → ${humanize(condition).toLowerCase()}`].filter(Boolean);
  await logActivity("asset", p.data.assetId, "status_changed", `${parts.join(", ")}${p.data.note ? ` — ${p.data.note}` : ""}`.replace(/^./, (c) => c.toUpperCase()));
  revalidatePath(`/assets/${p.data.assetId}`);
  revalidatePath("/assets/map");
  redirect(`/assets/${p.data.assetId}?notice=${encodeURIComponent("Status updated.")}`);
}

/* ── Components ── */

export async function linkComponentAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const assetId = Number(fd.get("assetId"));
  if (!Number.isInteger(assetId) || assetId <= 0) return { error: "That asset no longer exists." };
  const parentFacility = await facilityOfAsset(assetId);
  if (parentFacility == null) return { error: "That asset no longer exists." };
  await requireFacilityAccess(parentFacility, me);
  const tag = String(fd.get("tag") ?? "").trim().toUpperCase();
  if (!tag) return { error: "Enter the tag of the component." };
  const [c] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).where(eq(assets.assetTag, tag));
  if (!c) return { error: `No asset has the tag ${tag}.` };
  if (c.facilityId !== parentFacility) return { error: `${c.tag} is in another facility — a component must sit in the same facility as its parent.` };
  if (c.id === assetId) return { error: "An asset cannot be its own component." };
  // Prevent cycles: the parent must not already sit under the component.
  let cur: number | null = assetId;
  for (let i = 0; cur && i < 20; i++) {
    if (cur === c.id) return { error: "That would create a loop of components." };
    const [x]: { p: number | null }[] = await db.select({ p: assets.parentAssetId }).from(assets).where(eq(assets.id, cur));
    cur = x?.p ?? null;
  }
  await db.update(assets).set({ parentAssetId: assetId }).where(eq(assets.id, c.id));
  await logActivity("asset", assetId, "component_added", `${c.tag} added as a component`);
  revalidatePath(`/assets/${assetId}`);
  redirect(`/assets/${assetId}?notice=${encodeURIComponent(`${c.tag} linked as a component.`)}`);
}

export async function unlinkComponentAction(fd: FormData) {
  const me = await requirePermission("assets.edit");
  const assetId = Number(fd.get("assetId")), componentId = Number(fd.get("componentId"));
  if (!Number.isInteger(assetId) || assetId <= 0) redirect("/assets");
  await requireAssetAccess(assetId, me);
  await db.update(assets).set({ parentAssetId: null }).where(and(eq(assets.id, componentId), eq(assets.parentAssetId, assetId)));
  await logActivity("asset", assetId, "component_removed", `Component #${componentId} detached`);
  revalidatePath(`/assets/${assetId}`);
  redirect(`/assets/${assetId}?notice=${encodeURIComponent("Component detached.")}`);
}

/* ── Maintenance ── */

const MaintSchema = z.object({
  assetId: reqId("Asset"), type: oneOf("Type", MAINTENANCE_TYPES), status: oneOf("Status", MAINTENANCE_STATUSES),
  scheduledDate: isoDate("Scheduled date"), completedDate: isoDate("Completed date"), performedBy: text(120), vendorId: id(),
  cost: num("Cost", 0, 1e9), currency: text(3), downtimeHours: num("Downtime", 0, 100000), findings: text(4000),
  setStatus: oneOf("Asset status", ASSET_STATUSES), returnPath: text(200),
});

export async function logMaintenanceAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = MaintSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireAssetAccess(d.assetId, me);
  const status = d.status ?? (d.completedDate ? "COMPLETED" : "SCHEDULED");
  if (status === "COMPLETED" && !d.completedDate) return { error: "Enter the date the work was completed." };
  if (status !== "COMPLETED" && !d.scheduledDate) return { error: "Enter the scheduled date." };
  await db.insert(maintenanceEvents).values({
    assetId: d.assetId, type: d.type ?? "PPM", status, scheduledDate: d.scheduledDate ?? d.completedDate ?? null, completedDate: d.completedDate ?? null,
    performedBy: d.performedBy ?? null, vendorId: d.vendorId ?? null, cost: d.cost != null ? String(d.cost) : null,
    currency: d.cost != null ? (d.currency ?? "USD").toUpperCase() : null, downtimeHours: d.downtimeHours ?? null, findings: d.findings ?? null,
  });
  if (d.setStatus) await db.update(assets).set({ status: d.setStatus }).where(eq(assets.id, d.assetId));
  await logActivity("asset", d.assetId, "maintenance", `${maintenanceTypeLabel(d.type ?? "PPM")} ${status === "COMPLETED" ? `completed ${d.completedDate}` : `scheduled for ${d.scheduledDate}`}${d.findings ? ` — ${d.findings.slice(0, 120)}` : ""}`);
  revalidatePath(`/assets/${d.assetId}`);
  revalidatePath("/assets/maintenance");
  redirect(`${d.returnPath?.startsWith("/assets") ? d.returnPath : `/assets/${d.assetId}`}${d.returnPath?.includes("?") ? "&" : "?"}notice=${encodeURIComponent("Maintenance recorded.")}`);
}

const CompleteSchema = z.object({
  eventId: reqId("Event"), completedDate: isoDate("Completed date"), performedBy: text(120), vendorId: id(),
  cost: num("Cost", 0, 1e9), currency: text(3), downtimeHours: num("Downtime", 0, 100000), findings: text(4000),
  returnToService: z.string().optional(), condition: oneOf("Condition", ASSET_CONDITIONS), returnPath: text(300),
});

export async function completeEventAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = CompleteSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireFacilityAccess(await facilityOfEvent(d.eventId), me);
  if (!d.completedDate) return { error: "Enter the date the work was completed." };
  if (d.completedDate > todayISO()) return { error: "The completed date cannot be in the future." };
  const [e] = await db.select().from(maintenanceEvents).where(eq(maintenanceEvents.id, d.eventId));
  if (!e) return { error: "That work order no longer exists." };
  await db.update(maintenanceEvents).set({
    status: "COMPLETED", completedDate: d.completedDate, performedBy: d.performedBy ?? e.performedBy, vendorId: d.vendorId ?? null,
    cost: d.cost != null ? String(d.cost) : null, currency: d.cost != null ? (d.currency ?? "USD").toUpperCase() : null,
    downtimeHours: d.downtimeHours ?? null, findings: d.findings ?? e.findings,
  }).where(eq(maintenanceEvents.id, e.id));
  const assetPatch: Partial<typeof assets.$inferInsert> = {};
  if (d.returnToService) assetPatch.status = "IN_SERVICE";
  if (d.condition) assetPatch.condition = d.condition;
  if (Object.keys(assetPatch).length) await db.update(assets).set(assetPatch).where(eq(assets.id, e.assetId));
  await logActivity("asset", e.assetId, "maintenance", `${maintenanceTypeLabel(e.type)} completed ${d.completedDate}${d.returnToService ? ", returned to service" : ""}`);
  revalidatePath("/assets/maintenance");
  revalidatePath(`/assets/${e.assetId}`);
  const back = d.returnPath?.startsWith("/assets") ? d.returnPath : "/assets/maintenance?tab=schedule";
  redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(`${maintenanceTypeLabel(e.type)} marked complete.`)}`);
}

const GenerateSchema = z.object({ from: isoDate("From"), to: isoDate("To"), facilityId: id(), departmentId: id() });

/** Create scheduled PPM events for every in-use asset whose PPM falls in the window (skips months already planned). */
export async function generatePpmAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = GenerateSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const { from, to, facilityId, departmentId } = p.data;
  if (facilityId) await requireFacilityAccess(facilityId, me);
  const scope = await facilityScope(me);
  if (!from || !to || from > to) return { error: "Choose a window: the from date must be before the to date." };
  if (new Date(to).getTime() - new Date(from).getTime() > 3 * 366 * 86_400_000) return { error: "Plan at most three years at a time." };
  const list = await db.select({
    id: assets.id, status: assets.status, installDate: assets.installDate, purchaseDate: assets.purchaseDate, ppmIntervalMonths: deviceTypes.ppmIntervalMonths,
    lastPpmDate: sql<string | null>`(select max(m.completed_date) from maintenance_events m where m.asset_id = ${assets.id} and m.type = 'PPM' and m.status = 'COMPLETED')`,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(sql`${assets.status} in ('INSTALLED','IN_SERVICE','UNDER_MAINTENANCE')`,
      facilityId ? eq(assets.facilityId, facilityId) : undefined, departmentId ? eq(assets.departmentId, departmentId) : undefined,
      scopeWhere(assets.facilityId, scope)));
  const ids = list.map((a) => a.id);
  const existing = ids.length ? await db.select({ assetId: maintenanceEvents.assetId, scheduledDate: maintenanceEvents.scheduledDate, status: maintenanceEvents.status, type: maintenanceEvents.type })
    .from(maintenanceEvents).where(and(inArray(maintenanceEvents.assetId, ids), isNotNull(maintenanceEvents.scheduledDate))) : [];
  const plan = planPpmEvents(list, existing, from, to);
  for (let i = 0; i < plan.length; i += 500) {
    await db.insert(maintenanceEvents).values(plan.slice(i, i + 500).map((e) => ({ assetId: e.assetId, type: "PPM" as const, status: "SCHEDULED" as const, scheduledDate: e.scheduledDate })));
  }
  revalidatePath("/assets/maintenance");
  return { ok: plan.length ? `${plan.length} planned maintenance visits scheduled between ${from} and ${to} for ${new Set(plan.map((e) => e.assetId)).size} assets.` : "Nothing new to schedule — every PPM in that window is already planned." };
}

/* ── Bulk placement ── */

const BulkSchema = z.object({
  facilityId: reqId("Facility"), departmentId: reqId("Department"), deviceTypeId: reqId("Device type"),
  quantity: int("Quantity", 1, 500).refine((v) => v !== undefined, "Enter a quantity."),
  mode: z.enum(["PER_ROOM", "PER_BED", "ONE_ROOM", "MANUAL"], { error: "Choose how to distribute the units." }),
  targetRoomId: id(), manufacturer: text(120), model: text(120), serials: text(20000),
  status: oneOf("Status", ASSET_STATUSES), installDate: isoDate("Install date"), purchaseDate: isoDate("Purchase date"),
  warrantyMonths: int("Warranty months", 0, 240), unitCost: num("Unit cost", 0, 1e10), currency: text(3),
});

export async function bulkCreateAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const p = BulkSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireFacilityAccess(d.facilityId, me);
  const quantity = d.quantity as number;
  const deptRooms = await db.select({ id: rooms.id, code: rooms.code, name: rooms.name, beds: rooms.beds, type: rooms.type })
    .from(rooms).where(eq(rooms.departmentId, d.departmentId)).orderBy(rooms.code);
  const manual: Record<number, number> = {};
  for (const r of deptRooms) { const v = Number(fd.get(`count-${r.id}`)); if (Number.isFinite(v) && v > 0) manual[r.id] = Math.floor(v); }
  const res = distribute({ mode: d.mode as DistMode, rooms: deptRooms, quantity, targetRoomId: d.targetRoomId, manual });
  if (res.total === 0) return { error: res.warnings[0] ?? "Nothing to place — check the quantity and rooms." };
  if (d.mode === "MANUAL" && res.total !== quantity) return { error: res.warnings[0] };
  const serials = parseSerials(d.serials);
  if (serials.length && serials.length !== res.total) return { error: `You entered ${serials.length} serial numbers for ${res.total} units — give one per unit or leave them blank.` };
  const dupInList = serials.find((s, i) => serials.findIndex((x) => x.toUpperCase() === s.toUpperCase()) !== i);
  if (dupInList) return { error: `Serial ${dupInList} is listed twice.` };
  if (serials.length) {
    const taken = await db.select({ s: assets.serialNumber, tag: assets.assetTag }).from(assets)
      .where(inArray(sql`upper(${assets.serialNumber})`, serials.map((s) => s.toUpperCase()))).limit(1);
    if (taken[0]) return { error: `Serial ${taken[0].s} is already registered as ${taken[0].tag}.` };
  }
  const [dept] = await db.select({ facilityId: departments.facilityId, name: departments.name }).from(departments).where(eq(departments.id, d.departmentId));
  if (!dept || dept.facilityId !== d.facilityId) return { error: "That department is not in the chosen facility." };
  const roomIds = expandAllocations(res.allocations);
  const inputs: NewAssetInput[] = roomIds.map((roomId, i) => ({
    deviceTypeId: d.deviceTypeId, facilityId: d.facilityId, departmentId: d.departmentId, roomId,
    manufacturer: d.manufacturer ?? null, model: d.model ?? null, serialNumber: serials[i] ?? null, status: d.status,
    installDate: d.installDate ?? null, purchaseDate: d.purchaseDate ?? null, warrantyMonths: d.warrantyMonths ?? null,
    purchaseCost: d.unitCost ?? null, currency: d.unitCost != null ? (d.currency ?? "USD").toUpperCase() : null,
  }));
  const created = await createAssets(inputs);
  const [dt] = await db.select({ code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes).where(eq(deviceTypes.id, d.deviceTypeId));
  revalidatePath("/assets");
  revalidatePath("/assets/map");
  const msg = `${created.length} × ${dt?.name ?? "assets"} placed in ${res.allocations.length} room${res.allocations.length === 1 ? "" : "s"} of ${dept.name} (${created[0].assetTag} – ${created[created.length - 1].assetTag}).`;
  redirect(`/assets?departmentId=${d.departmentId}&deviceType=${dt?.code ?? ""}&notice=${encodeURIComponent(msg)}`);
}

/* ── Excel import ── */

export type ImportPreview = {
  error?: string;
  fileName?: string;
  facilityId?: number;
  rows?: RowResult[];
  validCount?: number;
  errorCount?: number;
  unknownHeaders?: string[];
  payload?: string;
  done?: string;
} | null;

async function lookupsFor(facilityId: number): Promise<Lookups> {
  const [dts, rms, dps, serials] = await Promise.all([
    db.select({ id: deviceTypes.id, code: deviceTypes.code, level: deviceTypes.level, name: deviceTypes.name }).from(deviceTypes),
    db.select({ id: rooms.id, code: rooms.code, departmentId: rooms.departmentId, name: rooms.name }).from(rooms)
      .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)),
    db.select({ id: departments.id, code: departments.code, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)),
    db.select({ s: assets.serialNumber, tag: assets.assetTag }).from(assets).where(isNotNull(assets.serialNumber)),
  ]);
  const roomsMap = new Map<string, { id: number; departmentId: number | null; name: string }[]>();
  for (const r of rms) roomsMap.set(r.code.toUpperCase(), [...(roomsMap.get(r.code.toUpperCase()) ?? []), r]);
  return {
    deviceTypes: new Map(dts.map((d) => [d.code.toUpperCase(), d])),
    rooms: roomsMap,
    departments: new Map(dps.map((d) => [d.code.toUpperCase(), d])),
    existingSerials: new Map(serials.map((s) => [String(s.s).toUpperCase(), s.tag])),
  };
}

/** Step 1: read the workbook and validate every row. Nothing is written. */
export async function previewImportAction(_: ImportPreview, fd: FormData): Promise<ImportPreview> {
  const me = await requirePermission("assets.edit");
  const facilityId = Number(fd.get("facilityId"));
  const file = fd.get("file");
  if (!Number.isInteger(facilityId) || facilityId <= 0) return { error: "Choose the facility the equipment belongs to." };
  await requireFacilityAccess(facilityId, me);
  const [fac] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, facilityId));
  if (!fac) return { error: "Choose the facility the equipment belongs to." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the filled-in .xlsx template to upload." };
  if (file.size > 10 * 1024 * 1024) return { error: "The workbook must be 10 MB or smaller." };
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer); }
  catch { return { error: "That file is not a readable .xlsx workbook. Save it as Excel Workbook (.xlsx) and try again." }; }
  const ws = wb.getWorksheet("Assets") ?? wb.worksheets[0];
  if (!ws) return { error: "The workbook has no sheets." };
  const header = ws.getRow(1).values as unknown[];
  const { map, missing, unknown } = mapHeaders(header);
  if (missing.length) return { error: `The first row must contain the column headers. Missing: ${missing.join(", ")}. Download the template to start from.` };
  const raw: { rowNumber: number; cells: Partial<Record<ImportKey, unknown>> }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const cells: Partial<Record<ImportKey, unknown>> = {};
    const vals = row.values as unknown[];
    for (const [idx, key] of map) cells[key] = vals[idx];
    raw.push({ rowNumber: n, cells });
  });
  if (raw.length > MAX_IMPORT_ROWS) return { error: `That sheet has ${raw.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.` };
  const { rows, valid } = validateRows(raw, await lookupsFor(facilityId));
  if (!rows.length) return { error: "The sheet has headers but no data rows." };
  return {
    fileName: file.name, facilityId, rows, validCount: valid.length, errorCount: rows.length - valid.length, unknownHeaders: unknown,
    payload: JSON.stringify({ facilityId, rows: valid }),
  };
}

const ValidRowSchema = z.object({
  rowNumber: z.number().int(), deviceTypeId: z.number().int().positive(), deviceTypeCode: z.string(), roomId: z.number().int().positive().nullable(),
  departmentId: z.number().int().positive().nullable(), manufacturer: z.string().nullable(), model: z.string().nullable(), serialNumber: z.string().nullable(),
  status: z.enum(ASSET_STATUSES).nullable(), condition: z.enum(ASSET_CONDITIONS).nullable(), purchaseDate: z.string().nullable(), installDate: z.string().nullable(),
  warrantyMonths: z.number().int().nullable(), warrantyEnd: z.string().nullable(), purchaseCost: z.number().nullable(), currency: z.string().nullable(), notes: z.string().nullable(),
});

/** Step 2: re-validate the previewed rows against the current database, then create them. */
export async function commitImportAction(_: ImportPreview, fd: FormData): Promise<ImportPreview> {
  const me = await requirePermission("assets.edit");
  let parsed: { facilityId: number; rows: ValidRow[] };
  try {
    parsed = z.object({ facilityId: z.number().int().positive(), rows: z.array(ValidRowSchema).min(1).max(MAX_IMPORT_ROWS) }).parse(JSON.parse(String(fd.get("payload") ?? "")));
  } catch { return { error: "The preview expired — upload the file again." }; }
  await requireFacilityAccess(parsed.facilityId, me); // the payload comes from the browser: check it again
  // Re-check against the live register (someone may have added the same serials since the preview).
  const lk = await lookupsFor(parsed.facilityId);
  const raw = parsed.rows.map((r) => {
    const roomCode = r.roomId ? [...lk.rooms.entries()].find(([, list]) => list.some((x) => x.id === r.roomId))?.[0] : undefined;
    const deptCode = r.departmentId ? [...lk.departments.entries()].find(([, d]) => d.id === r.departmentId)?.[0] : undefined;
    return { rowNumber: r.rowNumber, cells: { ...r, roomCode, departmentCode: deptCode } as Partial<Record<ImportKey, unknown>> };
  });
  const { rows, valid } = validateRows(raw, lk);
  if (valid.length !== parsed.rows.length) {
    const bad = rows.filter((r) => r.errors.length).slice(0, 3).map((r) => `row ${r.rowNumber}: ${r.errors[0]}`).join("; ");
    return { error: `Some rows are no longer valid (${bad}). Upload the file again to refresh the preview.` };
  }
  const created = await createAssets(valid.map((r) => ({
    deviceTypeId: r.deviceTypeId, facilityId: parsed.facilityId, roomId: r.roomId, departmentId: r.departmentId,
    manufacturer: r.manufacturer, model: r.model, serialNumber: r.serialNumber, status: r.status ?? undefined, condition: r.condition ?? undefined,
    purchaseDate: r.purchaseDate, installDate: r.installDate, warrantyMonths: r.warrantyMonths, warrantyEnd: r.warrantyEnd,
    purchaseCost: r.purchaseCost, currency: r.currency, notes: r.notes,
  })));
  revalidatePath("/assets");
  revalidatePath("/assets/map");
  return { done: `${created.length} assets imported: ${created[0].assetTag} – ${created[created.length - 1].assetTag}.` };
}
