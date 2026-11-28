import "server-only";
/** Database side of EDA vigilance (wave 40): devices kept as found, the hospital's safety contacts. Rules in ./vigilance. */
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetQuarantines, deviceTypes, assets, facilitySafetyContacts, safetyTests } from "@/db/schema";
import { safetyGateWarning } from "./safety-tests";

/** The open hold on a device, if any. */
export async function quarantineFor(assetId: number) {
  const [h] = await db.select().from(assetQuarantines).where(and(eq(assetQuarantines.assetId, assetId), isNull(assetQuarantines.releasedAt))).limit(1);
  return h ?? null;
}

export async function safetyContacts(facilityId: number) {
  const [c] = await db.select().from(facilitySafetyContacts).where(eq(facilitySafetyContacts.facilityId, facilityId));
  return c ?? null;
}

/**
 * Wave 40: the IEC 62353 gate at acceptance and after a repair. The device is in the programme when it, or a device of
 * its type in the hospital, has a test on record; then it needs a passed test since `since` (repair: when the job
 * started; acceptance: ever). Returns the warning or null.
 */
export async function safetyGate(assetId: number, context: "ACCEPTANCE" | "REPAIR", since: string | null): Promise<string | null> {
  const [a] = await db.select({ id: assets.id, typeId: assets.deviceTypeId, facilityId: assets.facilityId, code: deviceTypes.code }).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId));
  if (!a) return null;
  const [any] = await db.select({ id: safetyTests.id }).from(safetyTests).innerJoin(assets, eq(assets.id, safetyTests.assetId))
    .where(or(eq(safetyTests.assetId, a.id), and(eq(assets.deviceTypeId, a.typeId), eq(assets.facilityId, a.facilityId)))).limit(1);
  const [passed] = await db.select({ id: safetyTests.id }).from(safetyTests)
    .where(and(eq(safetyTests.assetId, a.id), eq(safetyTests.result, "PASS"), since ? gte(safetyTests.testedOn, since) : sql`true`)).orderBy(desc(safetyTests.testedOn)).limit(1);
  return safetyGateWarning({ context, inProgramme: !!any, passedSince: !!passed });
}
