"use server";
/** Wave 38: a service contract's covered hours (uptime counted only inside them). Needs `contracts.edit`. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contractCoverage, serviceContracts } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { coverageLabel, coverageProblem, type Coverage } from "@/lib/assets/coverage";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

const tick = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const Schema = z.object({
  contractId: z.coerce.number({ error: "Choose a contract." }).int().positive("Choose a contract."),
  allHours: tick, excludeHolidays: tick,
  fromTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Enter the start time as HH:MM."),
  toTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Enter the end time as HH:MM."),
});

export async function saveCoverageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("contracts.edit");
  const p = Schema.safeParse({ contractId: fd.get("contractId"), allHours: fd.get("allHours"), excludeHolidays: fd.get("excludeHolidays"),
    fromTime: fd.get("fromTime") ?? "08:00", toTime: fd.get("toTime") ?? "20:00" });
  if (!p.success) return zodFail(p.error);
  const [c] = await db.select({ id: serviceContracts.id, facilityId: serviceContracts.facilityId }).from(serviceContracts).where(eq(serviceContracts.id, p.data.contractId));
  if (!c) return fail("That contract no longer exists.");
  await requireFacilityAccess(c.facilityId, me);
  const days = [...new Set(fd.getAll("day").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  const cov: Coverage = { allHours: p.data.allHours, days, fromTime: p.data.fromTime, toTime: p.data.toTime, excludeHolidays: p.data.excludeHolidays };
  const problem = coverageProblem(cov);
  if (problem) return { errors: [problem], fields: { [/start time/.test(problem) ? "fromTime" : /end time/.test(problem) ? "toTime" : "day"]: problem } };
  const [before] = await db.select().from(contractCoverage).where(eq(contractCoverage.contractId, c.id));
  const v = { ...cov, days: cov.allHours ? before?.days ?? [0, 1, 2, 3, 4] : cov.days };
  await db.insert(contractCoverage).values({ contractId: c.id, ...v }).onConflictDoUpdate({ target: contractCoverage.contractId, set: v });
  const label = coverageLabel(cov);
  await logActivity("contract", c.id, "coverage_set", `Covered hours: ${label}${before ? ` (was ${coverageLabel(before)})` : ""}`, me.name);
  revalidatePath(`/assets/contracts/${c.id}`);
  revalidatePath(`/assets/contracts/${c.id}/statement`);
  return { message: `Covered hours saved: ${label}.` };
}
