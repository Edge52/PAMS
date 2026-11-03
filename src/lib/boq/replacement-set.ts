import "server-only";
/** The empty standard set used by BOQs made from the replacement plan and equipment requests (no rule lines). */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { standardSets } from "@/db/schema";

const REPLACEMENT_SET = "HPAMS-REPLACEMENT";

export async function replacementSetId(): Promise<number> {
  await db.insert(standardSets).values({
    code: REPLACEMENT_SET, name: "Replacement plan (no ratio rules)", version: "1.0", isDefault: false,
    description: "Used by BOQs created from the replacement plan. It has no rules, so regenerating such a BOQ keeps only its replacement lines.",
  }).onConflictDoNothing();
  const [s] = await db.select({ id: standardSets.id }).from(standardSets).where(eq(standardSets.code, REPLACEMENT_SET));
  return s.id;
}

