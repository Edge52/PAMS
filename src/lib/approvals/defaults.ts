/**
 * Default approval rules, loaded by the seed runner on every installation (reference data, not demo data).
 * Idempotent: an entity's defaults are only added when it has no rules at all, so an administrator's changes
 * (edited, deactivated or extra rows) are never overwritten.
 *
 * Amounts are EGP; a PO in another currency is converted at the stored exchange rate when it is submitted.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../../db";
import { approvalPolicies } from "../../db/schema";

type NewPolicy = typeof approvalPolicies.$inferInsert;

export const DEFAULT_POLICIES: NewPolicy[] = [
  { entity: "PO", label: "Procurement manager", approverRole: "PROCUREMENT", minAmountEgp: "0", stepOrder: 1 },
  { entity: "PO", label: "Finance", approverRole: "FINANCE", minAmountEgp: "1000000", stepOrder: 2 },
  { entity: "PO", label: "Hospital director", approverRole: "DIRECTOR", minAmountEgp: "2000000", stepOrder: 3 },
  { entity: "BOQ", label: "Hospital director", approverRole: "DIRECTOR", minAmountEgp: "0", stepOrder: 1 },
  // Awards: the committee members' signatures are added per tender; this is the final step (Law 182/2018 art. 35).
  { entity: "AWARD", label: "Competent authority", approverRole: "DIRECTOR", minAmountEgp: "0", stepOrder: 1 },
  // Condemning a device writes off a public asset: the director decides (add a Finance step under settings if needed).
  { entity: "DISPOSAL", label: "Hospital director", approverRole: "DIRECTOR", minAmountEgp: "0", stepOrder: 1 },
];

export async function ensureDefaultPolicies(db: DB): Promise<void> {
  let added = 0;
  for (const entity of ["PO", "BOQ", "AWARD", "DISPOSAL"] as const) {
    const [existing] = await db.select({ id: approvalPolicies.id }).from(approvalPolicies).where(eq(approvalPolicies.entity, entity)).limit(1);
    if (existing) continue;
    const rows = DEFAULT_POLICIES.filter((p) => p.entity === entity);
    await db.insert(approvalPolicies).values(rows);
    added += rows.length;
  }
  console.log(added ? `approvals: ${added} default approval rules added` : "approvals: approval rules already present");
}
