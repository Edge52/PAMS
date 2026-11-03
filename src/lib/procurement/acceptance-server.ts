import "server-only";
/** The acceptance sheet of a device (wave 10): its record, or a blank one from its type's checklist. */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { acceptances, assets, deviceTypes, poLines, purchaseOrders } from "@/db/schema";
import { blankResults, effectiveChecklist } from "@/lib/assets/checklists";
import { DEFAULT_ACCEPTANCE } from "./money";

export async function acceptanceSheet(assetId: number) {
  const [a] = await db.select({ typeId: assets.deviceTypeId, poLineId: assets.poLineId }).from(assets).where(eq(assets.id, assetId));
  if (!a) return null;
  const [rec] = await db.select().from(acceptances).where(eq(acceptances.assetId, assetId));
  const chain: { acceptanceChecklist: typeof deviceTypes.$inferSelect["acceptanceChecklist"]; parentId: number | null }[] = [];
  let id: number | null = a.typeId;
  for (let i = 0; id != null && i < 3; i++) {
    const [t] = await db.select({ acceptanceChecklist: deviceTypes.acceptanceChecklist, parentId: deviceTypes.parentId }).from(deviceTypes).where(eq(deviceTypes.id, id));
    if (!t) break; chain.push(t); id = t.parentId;
  }
  const items = effectiveChecklist(chain[0]?.acceptanceChecklist, chain[1]?.acceptanceChecklist, chain[2]?.acceptanceChecklist, () => DEFAULT_ACCEPTANCE).items;
  const [po] = a.poLineId ? await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, warrantyMonths: purchaseOrders.warrantyMonths }).from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId)).where(eq(poLines.id, a.poLineId)) : [];
  return { record: rec ?? null, sheet: rec?.results?.length ? rec.results : blankResults(items), po: po ?? null };
}
