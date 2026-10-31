import "server-only";
/**
 * The ONE way to create assets. Used by the asset register (manual / bulk / import) and by procurement
 * goods receipt (delivery → assets). OWNED BY THE LEAD.
 *
 * Fills defaults from the device type (criticality, life expectancy), computes warranty end,
 * generates the asset tag and logs the creation.
 */
import { eq, sql } from "drizzle-orm";
import { db, type DB } from "@/db";
import { assets, buildings, departments, deviceTypes, facilities, floors, rooms } from "@/db/schema";
import { addMonthsISO } from "./format";
import { logActivity } from "./server-utils";

type AssetInsert = typeof assets.$inferInsert;

export type NewAssetInput = {
  deviceTypeId: number;
  facilityId: number;
  departmentId?: number | null;
  roomId?: number | null;
  posX?: number | null;
  posY?: number | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  status?: AssetInsert["status"];
  condition?: AssetInsert["condition"];
  supplierId?: number | null;
  poLineId?: number | null;
  deliveryLineId?: number | null;
  purchaseCost?: number | string | null;
  currency?: string | null;
  purchaseDate?: string | null;     // YYYY-MM-DD
  installDate?: string | null;
  warrantyMonths?: number | null;   // used to compute warrantyEnd from installDate ?? purchaseDate
  warrantyEnd?: string | null;      // explicit value wins over warrantyMonths
  parentAssetId?: number | null;
  notes?: string | null;
};

/** Asset tag = <facility code>-<device category code>-<6-digit running number>, e.g. DGH-MON-000042. */
/** A database handle or an open transaction (`db.transaction(async (tx) => …)`). */
export type Executor = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export async function nextAssetTag(facilityCode: string, deviceTypeCode: string, x: Executor = db): Promise<string> {
  const res = await x.execute<{ n: string }>(sql`select nextval('asset_tag_seq')::text as n`);
  const category = deviceTypeCode.split("-")[0];
  return `${facilityCode}-${category}-${res.rows[0].n.padStart(6, "0")}`;
}

/** Pass `tx` to create the asset inside your own transaction (it then commits or rolls back with your other writes). */
export async function createAsset(input: NewAssetInput, actor?: string, tx?: Executor) {
  const x: Executor = tx ?? db;
  const [dt] = await x.select().from(deviceTypes).where(eq(deviceTypes.id, input.deviceTypeId));
  if (!dt) throw new Error(`Device type ${input.deviceTypeId} not found`);
  const [fac] = await x.select().from(facilities).where(eq(facilities.id, input.facilityId));
  if (!fac) throw new Error(`Facility ${input.facilityId} not found`);

  // If a room is given without a department, inherit the room's department.
  // Room and department must belong to the asset's facility (ids may come from a form or a spreadsheet).
  let departmentId = input.departmentId ?? null;
  if (input.roomId) {
    const [r] = await x.select({ departmentId: rooms.departmentId, facilityId: buildings.facilityId }).from(rooms)
      .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
      .where(eq(rooms.id, input.roomId));
    if (!r) throw new Error(`Room ${input.roomId} not found`);
    if (r.facilityId !== fac.id) throw new Error(`Room ${input.roomId} is not in ${fac.name}`);
    if (!departmentId) departmentId = r.departmentId ?? null;
  }
  if (departmentId) {
    const [d] = await x.select({ facilityId: departments.facilityId }).from(departments).where(eq(departments.id, departmentId));
    if (!d) throw new Error(`Department ${departmentId} not found`);
    if (d.facilityId !== fac.id) throw new Error(`Department ${departmentId} is not in ${fac.name}`);
  }

  const startDate = input.installDate ?? input.purchaseDate ?? null;
  const warrantyEnd = input.warrantyEnd ?? (startDate && input.warrantyMonths ? addMonthsISO(startDate, input.warrantyMonths) : null);

  const [row] = await x.insert(assets).values({
    assetTag: await nextAssetTag(fac.code, dt.code, x),
    deviceTypeId: dt.id,
    facilityId: fac.id,
    departmentId,
    roomId: input.roomId ?? null,
    posX: input.posX ?? null,
    posY: input.posY ?? null,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    serialNumber: input.serialNumber ?? null,
    status: input.status ?? (input.roomId ? "IN_SERVICE" : "IN_STOCK"),
    condition: input.condition ?? "NEW",
    criticality: dt.criticality,
    supplierId: input.supplierId ?? null,
    poLineId: input.poLineId ?? null,
    deliveryLineId: input.deliveryLineId ?? null,
    purchaseCost: input.purchaseCost != null ? String(input.purchaseCost) : null,
    currency: input.currency ?? null,
    purchaseDate: input.purchaseDate ?? null,
    installDate: input.installDate ?? null,
    warrantyEnd,
    lifeExpectancyYears: dt.lifeExpectancyYears,
    parentAssetId: input.parentAssetId ?? null,
    notes: input.notes ?? null,
  }).returning();

  await logActivity("asset", row.id, "created",
    `${dt.name} registered as ${row.assetTag}${input.poLineId ? " from goods receipt" : ""}`, actor, x);
  return row;
}

/** Create several assets sequentially (keeps tag numbers in order). */
export async function createAssets(inputs: NewAssetInput[], actor?: string, tx?: Executor) {
  const out = [];
  for (const i of inputs) out.push(await createAsset(i, actor, tx));
  return out;
}
