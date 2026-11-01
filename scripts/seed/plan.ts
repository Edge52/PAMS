/**
 * La Plaza fit-out plan (demo): an approved BOQ built from La Plaza's departments, so the 3D view's "Plan vs installed"
 * has something to compare the generated fit-out against. Runs after the CAD import; skipped when it exists.
 */
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../src/db";
import { boqDepartments, boqs, exchangeRates, facilities, standardSets } from "../../src/db/schema";
import { facilityScope, regenerateBoq, type ConvertFn } from "../../src/lib/boq/generate";

const NAME = "La Plaza — equipment fit-out plan";

export default async function seed(db: DB) {
  const [fac] = await db.select().from(facilities).where(eq(facilities.code, "LPH"));
  if (!fac) { console.log("  plan: La Plaza not imported, skipped"); return; }
  const [set] = await db.select().from(standardSets).orderBy(desc(standardSets.isDefault), standardSets.id).limit(1);
  if (!set) { console.log("  plan: no BOQ standard loaded, skipped"); return; }
  if ((await db.select({ id: boqs.id }).from(boqs).where(and(eq(boqs.name, NAME), eq(boqs.facilityId, fac.id)))).length) { console.log("  plan: exists, skipped"); return; }

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
  if (!scope.length) { console.log("  plan: La Plaza has no departments with a type, skipped"); return; }
  const [boq] = await db.insert(boqs).values({
    name: NAME, facilityId: fac.id, standardSetId: set.id, totalHospitalBeds: fac.totalBeds, currency: "USD",
    contingencyPct: 5, includeTiers: ["ESSENTIAL"], status: "APPROVED", openingDate: "2027-03-01", phaseMonths: [0, 6, 12, 18],
    notes: "Demo: generated from La Plaza's departments as the reference plan for commissioning (3D view → Plan vs installed).",
  }).returning({ id: boqs.id });
  // Demo phasing: critical care, emergency and theatres open first, wards six months later, the rest after a year.
  const phaseOf = (code: string) => (["ICU", "CCU", "NICU", "ER", "OR", "PACU", "RAD", "LAB"].includes(code) ? 1 : code.startsWith("WARD") || code === "LDR" ? 2 : 3);
  await db.insert(boqDepartments).values(scope.map((s) => ({ ...s, boqId: boq.id, phase: phaseOf(s.departmentTypeCode) })));
  const res = await regenerateBoq(db, boq.id, convert);
  console.log(`  plan: "${NAME}" — ${scope.length} departments, ${res.plan.counts.added} lines`);
}
