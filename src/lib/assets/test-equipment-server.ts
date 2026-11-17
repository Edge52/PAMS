import "server-only";
/**
 * Database side of test equipment on maintenance visits (wave 27). Every place that completes a maintenance visit
 * (completing a scheduled visit, recording completed maintenance on the asset, completing a work order) calls
 * `checkInstruments` before writing and `saveInstruments` with the visit's id after.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets, maintenanceTestEquipment } from "@/db/schema";
import { instrumentLabel, instrumentsProblem, parseInstrumentIds, type Instrument } from "./test-equipment";

type Tx = Pick<typeof db, "insert" | "delete">;

/** The hospital's test equipment, for the picker. */
export async function instrumentOptions(facilityId: number): Promise<Instrument[]> {
  return db.select({ id: assets.id, tag: assets.assetTag, manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber, calibrationDue: assets.calibrationDue })
    .from(assets).where(and(eq(assets.facilityId, facilityId), eq(assets.isTestEquipment, true), inArray(assets.status, ["IN_SERVICE", "INSTALLED", "IN_STOCK", "UNDER_MAINTENANCE"])))
    .orderBy(asc(assets.assetTag)).limit(100);
}

/** Reads `testEquipmentIds` from the form and checks them for work done on `on`. */
export async function checkInstruments(fd: FormData, facilityId: number, on: string): Promise<{ ok: Instrument[] } | { problem: string }> {
  const ids = parseInstrumentIds(fd.getAll("testEquipmentIds"));
  if (!ids.length) return { ok: [] };
  const found = await db.select({ id: assets.id, tag: assets.assetTag, manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber, calibrationDue: assets.calibrationDue })
    .from(assets).where(and(inArray(assets.id, ids), eq(assets.isTestEquipment, true), eq(assets.facilityId, facilityId)));
  const problem = instrumentsProblem(ids, found, on);
  return problem ? { problem } : { ok: found };
}

/** Records the instruments used on a visit (replacing any recorded before). */
export async function saveInstruments(tx: Tx, eventId: number, list: Instrument[]) {
  await tx.delete(maintenanceTestEquipment).where(eq(maintenanceTestEquipment.eventId, eventId));
  if (list.length) await tx.insert(maintenanceTestEquipment).values(list.map((i) => ({ eventId, assetId: i.id, label: instrumentLabel(i), calibrationDue: i.calibrationDue ?? null })));
}

/** Instruments recorded on these visits, by visit id. */
export async function instrumentsByEvent(eventIds: number[]): Promise<Map<number, { label: string; calibrationDue: string | null; assetId: number | null }[]>> {
  const out = new Map<number, { label: string; calibrationDue: string | null; assetId: number | null }[]>();
  if (!eventIds.length) return out;
  const rows = await db.select().from(maintenanceTestEquipment).where(inArray(maintenanceTestEquipment.eventId, eventIds)).orderBy(asc(maintenanceTestEquipment.id));
  for (const r of rows) { const l = out.get(r.eventId) ?? []; l.push({ label: r.label, calibrationDue: r.calibrationDue, assetId: r.assetId }); out.set(r.eventId, l); }
  return out;
}
