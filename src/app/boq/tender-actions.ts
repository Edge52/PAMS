"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { boqs, deviceTypes, projects, rfqLines, rfqs, specItems, techSpecs } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { pickLines, toRfqItems } from "@/lib/boq/tender-handoff";
import { handoffLines } from "@/lib/boq/tender-server";
import { fail, formObject, idParam, isUniqueViolation, optDate, optStr, reqStr, type ActionState, zodFail } from "@/lib/procurement/forms";
import { initialSpecItems } from "@/lib/procurement/spec-items";
import { logActivity, nextNumber } from "@/lib/server-utils";

const ids = (fd: FormData, key: string) => fd.getAll(key).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const optId = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional());

/**
 * Start a tender from a BOQ (wave 39): the ticked lines (or whole device type groups) become the items of a draft RFQ
 * in an existing project or a new one. Each RFQ item keeps its BOQ line ids, so the BOQ shows plan vs ordered.
 * A BOQ without a project is linked to the project used. Optionally starts a draft specification for each item.
 */
export async function startTenderFromBoq(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = z.object({
    boqId: idParam("BOQ missing"),
    projectMode: z.enum(["existing", "new"], { error: "Choose a project or create one" }),
    projectId: optId,
    code: optStr(48),
    title: optStr(300),
    rfqTitle: reqStr("Enter a title for the RFQ", 300),
    closingDate: optDate("Enter the closing date as a date"),
    makeSpecs: z.string().optional(),
  }).safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  const [boq] = await db.select().from(boqs).where(eq(boqs.id, d.boqId));
  if (!boq) return fail("This BOQ no longer exists.");
  await requireFacilityAccess(boq.facilityId, me);

  const items = toRfqItems(pickLines(await handoffLines(boq.id), ids(fd, "line"), ids(fd, "group")));
  if (!items.length) return fail("Tick at least one line with a quantity.");

  // The project: an existing one the user can see, or a new one for the BOQ's hospital.
  let project: typeof projects.$inferSelect | undefined;
  if (d.projectMode === "existing") {
    if (!d.projectId) return { errors: ["Choose the project."], fields: { projectId: "Choose the project." } };
    [project] = await db.select().from(projects).where(eq(projects.id, d.projectId));
    if (!project) return fail("That project no longer exists.");
    await requireFacilityAccess(project.facilityId, me);
    if (boq.facilityId && project.facilityId && project.facilityId !== boq.facilityId) return fail("That project is for another hospital. Choose one for this BOQ's hospital.");
  } else {
    if (!d.code) return { errors: ["Enter the tender or project code."], fields: { code: "Enter the tender or project code." } };
    if (!d.title) return { errors: ["Enter a project title."], fields: { title: "Enter a project title." } };
    try {
      [project] = await db.insert(projects).values({ code: d.code, title: d.title, facilityId: boq.facilityId, currency: boq.currency }).returning();
    } catch (e) {
      if (isUniqueViolation(e)) return { errors: [`A project with code ${d.code} already exists.`], fields: { code: "This code is taken." } };
      throw e;
    }
    await logActivity("project", project.id, "created", `Project ${project.code} created from BOQ ${boq.name} v${boq.version}`);
  }
  if (!boq.projectId) {
    await db.update(boqs).set({ projectId: project.id }).where(eq(boqs.id, boq.id));
    await logActivity("boq", boq.id, "linked", `Linked to project ${project.code}`);
  }

  // The RFQ, a draft, with its items frozen from the BOQ lines.
  let rfq: { id: number } | null = null;
  let number = "";
  for (let attempt = 0; attempt < 3 && !rfq; attempt++) {
    number = await nextNumber("RFQ", rfqs, rfqs.number);
    try {
      rfq = await db.transaction(async (tx) => {
        const [row] = await tx.insert(rfqs).values({
          projectId: project.id, number, title: d.rfqTitle, status: "DRAFT", closingDate: d.closingDate ?? null, boqId: boq.id,
        }).returning({ id: rfqs.id });
        await tx.insert(rfqLines).values(items.map((it) => ({
          rfqId: row.id, deviceTypeId: it.deviceTypeId, quantity: it.quantity, boqLineIds: it.boqLineIds, departments: it.departments, sortOrder: it.sortOrder,
        })));
        return row;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  if (!rfq) return fail("Could not allocate an RFQ number. Please try again.");

  // Specification links: a draft specification for each item the project has none for.
  let specs = 0;
  if (d.makeSpecs === "on" && can(me.role, "specs.edit")) {
    const typeIds = items.map((it) => it.deviceTypeId);
    const [have, types] = await Promise.all([
      db.select({ deviceTypeId: techSpecs.deviceTypeId }).from(techSpecs).where(and(eq(techSpecs.projectId, project.id), inArray(techSpecs.deviceTypeId, typeIds))),
      db.select().from(deviceTypes).where(inArray(deviceTypes.id, typeIds)),
    ]);
    const has = new Set(have.map((h) => h.deviceTypeId));
    for (const dt of types) {
      if (has.has(dt.id)) continue;
      const { items: specRows } = initialSpecItems(dt.code, dt.specTemplate, true);
      await db.transaction(async (tx) => {
        const [spec] = await tx.insert(techSpecs).values({ projectId: project.id, deviceTypeId: dt.id, title: `Technical specification — ${dt.name}`, version: 1 })
          .returning({ id: techSpecs.id });
        if (specRows.length) {
          await tx.insert(specItems).values(specRows.map((i, idx) => ({
            specId: spec.id, section: i.section || null, parameter: i.parameter, requirement: i.requirement, unit: i.unit || null,
            mandatory: i.mandatory, weight: i.weight, sortOrder: (idx + 1) * 10,
          })));
        }
      });
      specs++;
    }
  }

  const units = items.reduce((s, it) => s + it.quantity, 0);
  const lines = items.reduce((s, it) => s + it.boqLineIds.length, 0);
  await logActivity("rfq", rfq.id, "created", `${number} drafted from BOQ ${boq.name} v${boq.version}: ${items.length} item${items.length === 1 ? "" : "s"}, ${units} units`);
  await logActivity("project", project.id, "rfq_created", `${number} drafted from BOQ ${boq.name}${specs ? `; ${specs} draft specification${specs === 1 ? "" : "s"} started` : ""}`);
  await logActivity("boq", boq.id, "tender_started", `${number} in ${project.code}: ${lines} line${lines === 1 ? "" : "s"}, ${units} units`);
  revalidatePath(`/boq/${boq.id}`);
  revalidatePath(`/procurement/${project.id}`);
  redirect(`/procurement/rfqs/${rfq.id}`);
}
