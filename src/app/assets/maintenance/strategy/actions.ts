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
import { emNumber, STRATEGIES } from "@/lib/assets/risk";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

const Schema = z.object({
  id: reqId("Device type"), riskFunction: int("Equipment function", 2, 10), riskPhysical: int("Physical risk", 1, 5), riskMaintenance: int("Maintenance need", 1, 5),
  maintenanceStrategy: oneOf("Strategy", STRATEGIES), strategyReason: text(1000), ppmIntervalMonths: int("Interval", 1, 120), back: text(300),
});

export async function saveRiskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("catalogue.edit");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [t] = await db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes).where(eq(deviceTypes.id, d.id));
  if (!t) return fail("That device type no longer exists.");
  if (d.maintenanceStrategy && !d.strategyReason) return { errors: ["Write down why this strategy was chosen."], fields: { strategyReason: "Give the reason: an inspector will ask for it." } };
  if (d.maintenanceStrategy && d.maintenanceStrategy !== "RUN_TO_FAILURE" && !d.ppmIntervalMonths) return { errors: ["Planned maintenance needs an interval."], fields: { ppmIntervalMonths: "Enter the months between visits." } };
  const interval = d.maintenanceStrategy === "RUN_TO_FAILURE" ? null : d.ppmIntervalMonths ?? null;
  await db.update(deviceTypes).set({
    riskFunction: d.riskFunction ?? null, riskPhysical: d.riskPhysical ?? null, riskMaintenance: d.riskMaintenance ?? null,
    maintenanceStrategy: d.maintenanceStrategy ?? null, strategyReason: d.strategyReason ?? null, ppmIntervalMonths: interval,
  }).where(eq(deviceTypes.id, t.id));
  const em = emNumber(d);
  await logActivity("device_type", t.id, "risk_saved", `${t.name}: risk score ${em ?? "not complete"}, strategy ${d.maintenanceStrategy ?? "not chosen"}${interval ? `, every ${interval} months` : ""}`, me.name);
  revalidatePath("/assets/maintenance/strategy"); revalidatePath(`/catalogue/${t.code}`);
  const back = d.back && d.back.startsWith("/assets/maintenance/strategy") ? d.back : "/assets/maintenance/strategy";
  return redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(`${t.name} saved.`)}`);
}
