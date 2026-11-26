"use server";
/** Risk score and maintenance strategy of a device type (wave 23). Needs `catalogue.edit`: the types are shared by every hospital. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { deviceTypes } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { formObject, int, oneOf, reqId, text } from "@/lib/assets/forms";
import { emNumber, STRATEGIES, strategyRefusal } from "@/lib/assets/risk";
import { evidenceFor, fleetHistory, historyRule, saveEvidence } from "@/lib/assets/strategy-server";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";
import { changeSummary, diff } from "@/lib/audit-diff";

const Schema = z.object({
  id: reqId("Device type"), riskFunction: int("Equipment function", 2, 10), riskPhysical: int("Physical risk", 1, 5), riskMaintenance: int("Maintenance need", 1, 5),
  maintenanceStrategy: oneOf("Strategy", STRATEGIES), strategyReason: text(1000), evidence: text(4000), ppmIntervalMonths: int("Interval", 1, 120), back: text(300),
});

export async function saveRiskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("catalogue.edit");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [t] = await db.select().from(deviceTypes).where(eq(deviceTypes.id, d.id));
  if (!t) return fail("That device type no longer exists.");
  if (d.maintenanceStrategy && !d.strategyReason) return { errors: ["Write down why this strategy was chosen."], fields: { strategyReason: "Give the reason: an inspector will ask for it." } };
  // Wave 39: no alternative schedule or run to failure for imaging, MRI, lasers or types without enough history; an
  // alternative schedule needs its evidence written down (CMS S&C 14-07, Joint Commission FAQ).
  const [fleet, rule, ev] = await Promise.all([fleetHistory([t.id]), historyRule(), evidenceFor([t.id])]);
  const refusal = strategyRefusal({ code: t.code, maintenanceStrategy: d.maintenanceStrategy ?? null, fleet: fleet.get(t.id), rule });
  if (refusal) return { errors: [refusal], fields: { maintenanceStrategy: refusal } };
  if (d.maintenanceStrategy === "ALTERNATIVE" && !d.evidence) return { errors: ["Write down the evidence or risk basis for the hospital's own schedule."], fields: { evidence: "Give the evidence: failure history, maker's guidance, risk review." } };
  if (d.maintenanceStrategy && d.maintenanceStrategy !== "RUN_TO_FAILURE" && !d.ppmIntervalMonths) return { errors: ["Planned maintenance needs an interval."], fields: { ppmIntervalMonths: "Enter the months between visits." } };
  const interval = d.maintenanceStrategy === "RUN_TO_FAILURE" ? null : d.ppmIntervalMonths ?? null;
  const next = {
    riskFunction: d.riskFunction ?? null, riskPhysical: d.riskPhysical ?? null, riskMaintenance: d.riskMaintenance ?? null,
    maintenanceStrategy: d.maintenanceStrategy ?? null, strategyReason: d.strategyReason ?? null, ppmIntervalMonths: interval,
  };
  const evidence = d.evidence ?? null;
  const changes = diff({ ...t, evidence: ev.get(t.id) ?? null }, { ...next, evidence });
  await db.transaction(async (tx) => {
    await tx.update(deviceTypes).set(next).where(eq(deviceTypes.id, t.id));
    await saveEvidence(t.id, evidence, me.name, tx);
  });
  const em = emNumber(d);
  await logActivity("device_type", t.id, "risk_saved", `${t.name}: risk score ${em ?? "not complete"}, strategy ${d.maintenanceStrategy ?? "not chosen"}${interval ? `, every ${interval} months` : ""}${changes ? `. ${changeSummary(changes)}` : ""}`, me.name, db, changes);
  revalidatePath("/assets/maintenance/strategy"); revalidatePath(`/catalogue/${t.code}`);
  const back = d.back && d.back.startsWith("/assets/maintenance/strategy") ? d.back : "/assets/maintenance/strategy";
  return redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(`${t.name} saved.`)}`);
}
