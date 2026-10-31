"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { deviceTypes, offerLines, projects, specItems, techSpecs } from "@/db/schema";
import { logActivity } from "@/lib/server-utils";
import { fail, formObject, idParam, jsonField, optStr, reqStr, zodErrors, type ActionState } from "@/lib/procurement/forms";
import { initialSpecItems, planSpecItems } from "@/lib/procurement/spec-items";
import { advanceProject } from "@/lib/procurement/server";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";

async function specFor(specId: number, me: CurrentUser) {
  const [row] = await db.select({ spec: techSpecs, facilityId: projects.facilityId }).from(techSpecs)
    .leftJoin(projects, eq(projects.id, techSpecs.projectId)).where(eq(techSpecs.id, specId));
  if (!row) return null;
  await requireFacilityAccess(row.facilityId, me);
  return row.spec;
}

export async function createSpec(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("specs.edit");
  const parsed = z.object({
    projectId: idParam("Choose a project"),
    deviceTypeId: idParam("Choose the device type to specify"),
    title: optStr(300),
    includeGeneral: z.string().optional(),
  }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const { projectId, deviceTypeId } = parsed.data;
  const [[project], [dt]] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, projectId)),
    db.select().from(deviceTypes).where(eq(deviceTypes.id, deviceTypeId)),
  ]);
  if (!project) return fail("This project no longer exists.");
  await requireFacilityAccess(project.facilityId, me);
  if (!dt || dt.level !== 3) return fail("Choose a specific device type (not a category).");
  const existing = await db.select({ id: techSpecs.id, version: techSpecs.version }).from(techSpecs)
    .where(and(eq(techSpecs.projectId, projectId), eq(techSpecs.deviceTypeId, deviceTypeId)));
  if (existing.length) return fail(`This project already has a specification for ${dt.name}. Open it from the list to edit it.`);

  const { items, source } = initialSpecItems(dt.code, dt.specTemplate, parsed.data.includeGeneral === "on");
  const specId = await db.transaction(async (tx) => {
    const [spec] = await tx.insert(techSpecs).values({
      projectId, deviceTypeId, title: parsed.data.title ?? `Technical specification — ${dt.name}`, version: 1,
    }).returning({ id: techSpecs.id });
    if (items.length) {
      await tx.insert(specItems).values(items.map((i, idx) => ({
        specId: spec.id, section: i.section || null, parameter: i.parameter, requirement: i.requirement, unit: i.unit || null,
        mandatory: i.mandatory, weight: i.weight, sortOrder: (idx + 1) * 10,
      })));
    }
    return spec.id;
  });
  const from = source === "template" ? "the device type template" : source === "library" ? "the starter library" : "general conditions only";
  await logActivity("spec", specId, "created", `Specification for ${dt.name} created from ${from} (${items.length} items)`);
  await logActivity("project", projectId, "spec_created", `Specification added for ${dt.name}`);
  await advanceProject(projectId, "SPECIFICATION", "first specification written");
  revalidatePath(`/procurement/${projectId}`);
  redirect(`/procurement/specs/${specId}`);
}

export async function saveSpecItems(specId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("specs.edit");
  const spec = await specFor(specId, me);
  if (!spec) return fail("This specification no longer exists.");
  const existing = await db.select({ id: specItems.id }).from(specItems).where(eq(specItems.specId, specId));
  const plan = planSpecItems(existing.map((e) => e.id), jsonField(fd, "items"));
  if (plan.errors.length) return fail(...plan.errors);

  const header = z.object({ title: reqStr("Enter a title for the specification", 300), notes: optStr(4000) }).safeParse(formObject(fd));
  if (!header.success) return fail(...zodErrors(header.error));

  await db.transaction(async (tx) => {
    await tx.update(techSpecs).set({ title: header.data.title, notes: header.data.notes ?? null }).where(eq(techSpecs.id, specId));
    if (plan.remove.length) await tx.delete(specItems).where(inArray(specItems.id, plan.remove));
    for (const u of plan.update) {
      await tx.update(specItems).set({
        section: u.section || null, parameter: u.parameter, requirement: u.requirement, unit: u.unit || null,
        mandatory: u.mandatory, weight: u.weight, sortOrder: u.sortOrder,
      }).where(eq(specItems.id, u.id));
    }
    if (plan.insert.length) {
      await tx.insert(specItems).values(plan.insert.map((i) => ({
        specId, section: i.section || null, parameter: i.parameter, requirement: i.requirement, unit: i.unit || null,
        mandatory: i.mandatory, weight: i.weight, sortOrder: i.sortOrder,
      })));
    }
  });
  const parts = [`${plan.update.length + plan.insert.length} items`];
  if (plan.insert.length) parts.push(`${plan.insert.length} added`);
  if (plan.remove.length) parts.push(`${plan.remove.length} removed`);
  await logActivity("spec", specId, "updated", `Specification saved: ${parts.join(", ")}`);
  revalidatePath(`/procurement/specs/${specId}`);
  if (spec.projectId) revalidatePath(`/procurement/${spec.projectId}`);
  return { message: `Saved. ${parts.join(", ")}.` };
}

export async function deleteSpec(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("specs.edit");
  const id = Number(fd.get("specId"));
  const spec = await specFor(id, me);
  if (!spec) return fail("This specification no longer exists.");
  const used = await db.select({ id: offerLines.id }).from(offerLines).where(eq(offerLines.specId, id)).limit(1);
  await db.delete(techSpecs).where(eq(techSpecs.id, id));
  if (spec.projectId) await logActivity("project", spec.projectId, "spec_deleted", `Specification "${spec.title}" deleted${used.length ? " (compliance answers on offers were removed)" : ""}`);
  revalidatePath(`/procurement/${spec.projectId}`);
  redirect(spec.projectId ? `/procurement/${spec.projectId}?tab=specs` : "/procurement");
}
