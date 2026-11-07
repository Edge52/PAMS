"use server";
/** Saved queue simulation scenarios (wave 15): save the page's settings and what-if, delete them. Return a result, no redirect. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { simScenarios } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { cleanScenario, type SimScenario } from "@/lib/flows/scenarios";
import { DEFAULT_PORTERS } from "@/lib/flows/simulate-model";
import { logActivity } from "@/lib/server-utils";

export type SavedScenario = { id: number; name: string; shared: boolean; mine: boolean; by: string | null; settings: SimScenario };
export type ScenarioResult = { ok?: string; error?: string; scenario?: SavedScenario; deletedId?: number };

const SaveSchema = z.object({
  facilityId: z.number().int().positive(),
  name: z.string().trim().min(1, "Give the scenario a name.").max(80, "Keep the name under 80 characters."),
  shared: z.boolean(),
  settings: z.unknown(),
});

/** Save the settings as a scenario of this hospital (private to its author unless shared). */
export async function saveScenarioAction(input: { facilityId: number; name: string; shared: boolean; settings: unknown }): Promise<ScenarioResult> {
  const me = await requirePermission("assets.view");
  const p = SaveSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the scenario." };
  await requireFacilityAccess(p.data.facilityId, me);
  const settings = cleanScenario(p.data.settings, DEFAULT_PORTERS);
  if (JSON.stringify(settings).length > 100_000) return { error: "These settings are too large to save." };
  const [row] = await db.insert(simScenarios).values({ facilityId: p.data.facilityId, name: p.data.name, settings, shared: p.data.shared, createdById: me.id, createdByName: me.name }).returning({ id: simScenarios.id });
  await logActivity("facility", p.data.facilityId, "SIM_SCENARIO_SAVED", `Queue simulation scenario “${p.data.name}” saved${p.data.shared ? " and shared" : ""}`);
  return { ok: `Scenario “${p.data.name}” saved${p.data.shared ? " and shared" : ""}.`, scenario: { id: row.id, name: p.data.name, shared: p.data.shared, mine: true, by: me.name, settings } };
}

/** Delete a scenario: its author, or an administrator. */
export async function deleteScenarioAction(id: number): Promise<ScenarioResult> {
  const me = await requirePermission("assets.view");
  const [s] = Number.isInteger(id) ? await db.select().from(simScenarios).where(eq(simScenarios.id, id)) : [];
  if (!s) return { error: "That scenario no longer exists." };
  await requireFacilityAccess(s.facilityId, me);
  if (s.createdById !== me.id && !can(me.role, "users.manage")) return { error: "Only the person who saved this scenario can delete it." };
  await db.delete(simScenarios).where(eq(simScenarios.id, s.id));
  await logActivity("facility", s.facilityId, "SIM_SCENARIO_DELETED", `Queue simulation scenario “${s.name}” deleted`);
  return { ok: `Scenario “${s.name}” deleted.`, deletedId: s.id };
}
