"use server";
/** Wave 41: key software components of a make and model (its SBOM, MDS2). Needs `catalogue.edit`. */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { deviceModels, modelSoftwareComponents } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { formObject, isoDate, reqId, reqText, text } from "@/lib/assets/forms";
import { fail, ok, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

const Add = z.object({ modelId: reqId("Model"), name: reqText("Component", 160), version: text(64), supplier: text(160), supportEnds: isoDate("Support ends"), notes: text(500) });

export async function addComponentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("catalogue.edit");
  const p = Add.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [m] = await db.select({ id: deviceModels.id }).from(deviceModels).where(eq(deviceModels.id, d.modelId));
  if (!m) return fail("That model is no longer in the catalogue.");
  const n = await db.$count(modelSoftwareComponents, eq(modelSoftwareComponents.deviceModelId, m.id));
  if (n >= 200) return fail("A model keeps at most 200 key components. Attach the full SBOM file instead.");
  await db.insert(modelSoftwareComponents).values({ deviceModelId: m.id, name: d.name, version: d.version ?? null, supplier: d.supplier ?? null, supportEnds: d.supportEnds ?? null, notes: d.notes ?? null });
  await logActivity("device_model", m.id, "updated", `Software component added: ${d.name}${d.version ? ` ${d.version}` : ""}`, me.name);
  revalidatePath(`/catalogue/models/${m.id}`);
  return ok("Component added.");
}

const Remove = z.object({ modelId: reqId("Model"), componentId: reqId("Component") });

export async function removeComponentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("catalogue.edit");
  const p = Remove.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const [c] = await db.delete(modelSoftwareComponents)
    .where(and(eq(modelSoftwareComponents.id, p.data.componentId), eq(modelSoftwareComponents.deviceModelId, p.data.modelId))).returning();
  if (!c) return fail("That component is already gone.");
  await logActivity("device_model", p.data.modelId, "updated", `Software component removed: ${c.name}${c.version ? ` ${c.version}` : ""}`, me.name);
  revalidatePath(`/catalogue/models/${p.data.modelId}`);
  return ok("Component removed.");
}
