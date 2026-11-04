/**
 * Money (demo, wave 10): a budget line per hospital for this year with the existing POs charged to it. Skipped when
 * any budget line exists. Figures are made up for the demo.
 */
import { eq, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { budgetLines, facilities, purchaseOrders } from "../../src/db/schema";

export default async function seed(db: DB) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(budgetLines);
  if (n > 0) { console.log("  money: budgets exist, skipped"); return; }
  const year = new Date().getFullYear();
  for (const f of await db.select({ id: facilities.id }).from(facilities)) {
    const [l] = await db.insert(budgetLines).values({ facilityId: f.id, year, name: "Medical equipment (demo)", amount: "80000000.00", currency: "EGP", notes: "Demo" }).returning({ id: budgetLines.id });
    await db.update(purchaseOrders).set({ budgetLineId: l.id }).where(eq(purchaseOrders.facilityId, f.id));
  }
  console.log("  money: a demo budget line per hospital");
}
