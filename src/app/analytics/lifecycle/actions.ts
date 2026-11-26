"use server";
/** Saved capital what-if scenarios (wave 40, Analytics › Lifecycle). */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { capitalScenarios } from "@/db/schema";
import { cleanSettings } from "@/lib/analytics/capital-whatif";
import type { FormState } from "@/lib/assets/forms";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";

const SaveSchema = z.object({
  facilityId: z.coerce.number().int().positive("Pick one hospital in the filters first."),
  name: z.string().trim().min(1, "Give the scenario a name.").max(80, "Keep the name under 80 characters."),
});

/** Save (or overwrite by name) a scenario for one hospital. Same permission as the capital budget. */
export async function saveScenarioAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.edit");
  const p = SaveSchema.safeParse({ facilityId: fd.get("facilityId"), name: fd.get("name") });
  if (!p.success) return { error: p.error.issues[0].message };
  await requireFacilityAccess(p.data.facilityId, me);
  const settings = cleanSettings({ delayYears: fd.get("delayYears"), budgetPerYear: fd.get("budgetPerYear"), includeTypes: fd.get("includeTypes") });
  const [row] = await db.insert(capitalScenarios).values({ facilityId: p.data.facilityId, name: p.data.name, settings, createdById: me.id, createdByName: me.name })
    .onConflictDoUpdate({ target: [capitalScenarios.facilityId, capitalScenarios.name], set: { settings, updatedAt: new Date() } })
    .returning({ id: capitalScenarios.id });
  await logActivity("facility", p.data.facilityId, "capital scenario", `Saved what-if "${p.data.name}"`, me.name);
  revalidatePath("/analytics/lifecycle");
  return { ok: `Scenario "${p.data.name}" saved (no. ${row.id}).` };
}

export async function deleteScenarioAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.edit");
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Choose a scenario." };
  const [s] = await db.select().from(capitalScenarios).where(eq(capitalScenarios.id, id));
  if (!s) return { error: "That scenario no longer exists." };
  await requireFacilityAccess(s.facilityId, me);
  await db.delete(capitalScenarios).where(and(eq(capitalScenarios.id, id), eq(capitalScenarios.facilityId, s.facilityId)));
  await logActivity("facility", s.facilityId, "capital scenario", `Deleted what-if "${s.name}"`, me.name);
  revalidatePath("/analytics/lifecycle");
  return { ok: `Scenario "${s.name}" deleted.` };
}
