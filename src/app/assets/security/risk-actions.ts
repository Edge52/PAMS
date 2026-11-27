"use server";
/** Wave 41: network risk per connection (IEC 80001-1) on a device. Needs `assets.edit` and the device's hospital. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assets, networkRisks } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, int, isoDate, oneOf, reqId, text } from "@/lib/assets/forms";
import { RISK_STATUSES, riskLevel, riskProblems, riskScore } from "@/lib/assets/network-risk";
import { diff } from "@/lib/audit-diff";
import { fail, ok, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";

const Schema = z.object({
  assetId: reqId("Device"), riskId: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)),
  connectsTo: z.string().trim().min(1, "Say what system the device connects to.").max(200), dataExchanged: text(500),
  hazard: z.string().trim().min(1, "Say what could go wrong.").max(1000),
  likelihood: int("Likelihood", 1, 5), severity: int("Severity", 1, 5), controls: text(2000),
  residualLikelihood: int("Likelihood after controls", 1, 5), residualSeverity: int("Severity after controls", 1, 5),
  owner: text(120), reviewDue: isoDate("Review date"), status: oneOf("Status", RISK_STATUSES),
});

async function deviceFor(assetId: number) {
  const [a] = await db.select({ id: assets.id, facilityId: assets.facilityId }).from(assets).where(eq(assets.id, assetId));
  return a ?? null;
}

export async function saveNetworkRiskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const a = await deviceFor(d.assetId);
  if (!a) return fail("That device is not in the register.");
  await requireFacilityAccess(a.facilityId, me);
  const values = {
    connectsTo: d.connectsTo, dataExchanged: d.dataExchanged ?? null, hazard: d.hazard,
    likelihood: d.likelihood ?? 0, severity: d.severity ?? 0, controls: d.controls ?? null,
    residualLikelihood: d.residualLikelihood ?? 0, residualSeverity: d.residualSeverity ?? 0,
    owner: d.owner ?? null, reviewDue: d.reviewDue ?? null, status: d.status ?? "OPEN",
  };
  const bad = riskProblems(values, todayISO());
  if (Object.keys(bad).length) return { errors: Object.values(bad), fields: bad };
  const level = riskLevel(riskScore(values.residualLikelihood, values.residualSeverity));
  if (d.riskId) {
    const [before] = await db.select().from(networkRisks).where(eq(networkRisks.id, d.riskId));
    if (!before || before.assetId !== a.id) return fail("That risk entry is not on this device.");
    await db.update(networkRisks).set(values).where(eq(networkRisks.id, before.id));
    await logActivity("asset", a.id, "updated", `Network risk for ${values.connectsTo} updated (residual ${level})`, me.name, db, diff(before, values));
  } else {
    await db.insert(networkRisks).values({ ...values, assetId: a.id, facilityId: a.facilityId, recordedById: me.id, recordedByName: me.name });
    await logActivity("asset", a.id, "updated", `Network risk recorded: ${values.connectsTo} (residual ${level})`, me.name);
  }
  revalidatePath(`/assets/${a.id}`);
  return ok("Network risk saved.");
}
