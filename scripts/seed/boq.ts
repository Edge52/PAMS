/**
 * BOQ demo seed: one baseline BOQ for the demo hospital (DGH), its scope imported from the facility's departments,
 * generated from the default standard set with the same engine the app uses. Skips cleanly when the facility or a
 * standard set is missing (e.g. while seed-data/boq-standards.json is still empty).
 */
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../src/db";
import { boqDepartments, boqs, exchangeRates, facilities, standardSets } from "../../src/db/schema";
import { facilityScope, regenerateBoq, type ConvertFn } from "../../src/lib/boq/generate";

const NAME = "Demo General Hospital — baseline BOQ";

export default async function seed(db: DB) {
  const [fac] = await db.select().from(facilities).where(eq(facilities.code, "DGH"));
  if (!fac) { console.log("  boq: facility DGH not found, skipped"); return; }
  const [set] = await db.select().from(standardSets).orderBy(desc(standardSets.isDefault), standardSets.id).limit(1);
  if (!set) { console.log("  boq: no standard set loaded yet (seed-data/boq-standards.json is empty), skipped"); return; }
  const existing = await db.select({ id: boqs.id }).from(boqs).where(and(eq(boqs.name, NAME), eq(boqs.facilityId, fac.id)));
  if (existing.length) { console.log("  boq: demo BOQ exists, skipped"); return; }

  // convert() from server-utils is server-only; the seed reads the same exchange_rates table directly.
  const rate = async (c: string) => {
    if (c === "EGP") return 1;
    const [r] = await db.select().from(exchangeRates).where(eq(exchangeRates.currency, c)).orderBy(desc(exchangeRates.effectiveDate)).limit(1);
    return r ? Number(r.rateToEgp) : null;
  };
  const convert: ConvertFn = async (amount, from, to) => {
    if (from === to) return amount;
    const [a, b] = [await rate(from), await rate(to)];
    return a == null || b == null ? null : (amount * a) / b;
  };

  const scope = await facilityScope(db, fac.id);
  const [boq] = await db.insert(boqs).values({
    name: NAME, facilityId: fac.id, standardSetId: set.id, totalHospitalBeds: fac.totalBeds, currency: "USD",
    contingencyPct: 5, includeTiers: ["ESSENTIAL", "RECOMMENDED"],
    notes: "Baseline generated from the facility's departments. Review the ratios on the Assumptions tab.",
  }).returning({ id: boqs.id });
  if (scope.length) await db.insert(boqDepartments).values(scope.map((s) => ({ ...s, boqId: boq.id })));
  const res = await regenerateBoq(db, boq.id, convert);
  console.log(`  boq: "${NAME}" — ${scope.length} departments, ${res.plan.counts.added} lines from ${set.code}`);
}
