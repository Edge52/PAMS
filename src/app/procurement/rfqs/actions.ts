"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { boqs, deviceTypes, projects, rfqLines as rfqLineRows, rfqs, rfqSuppliers, suppliers } from "@/db/schema";
import { todayISO } from "@/lib/format";
import { logActivity, nextNumber } from "@/lib/server-utils";
import { fail, formObject, idParam, isUniqueViolation, optDate, optStr, reqStr, zodErrors, type ActionState } from "@/lib/procurement/forms";
import { humanizeEnum, RFQ_STATUSES } from "@/lib/procurement/labels";
import { advanceProject, deriveRfqLines, joinRfqNotes, splitRfqNotes } from "@/lib/procurement/server";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";

/** The RFQ with its project's facility checked against the user's access. */
async function rfqFor(rfqId: number, me: CurrentUser) {
  const [row] = await db.select({ rfq: rfqs, facilityId: projects.facilityId }).from(rfqs)
    .innerJoin(projects, eq(projects.id, rfqs.projectId)).where(eq(rfqs.id, rfqId));
  if (!row) return null;
  await requireFacilityAccess(row.facilityId, me);
  return row.rfq;
}

const ids = (fd: FormData, key: string) => fd.getAll(key).map(Number).filter((n) => Number.isInteger(n) && n > 0);

export async function createRfq(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = z.object({
    projectId: idParam("Choose a project"),
    boqId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
    title: reqStr("Enter a title for the RFQ", 300),
    issueDate: optDate("Enter the issue date as a date"),
    closingDate: optDate("Enter the closing date as a date"),
    notes: optStr(4000),
    intent: z.enum(["draft", "issue"]).default("draft"),
  }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const d = parsed.data;
  const [project] = await db.select().from(projects).where(eq(projects.id, d.projectId));
  if (!project) return fail("This project no longer exists.");
  await requireFacilityAccess(project.facilityId, me);
  if (d.boqId) {
    const [b] = await db.select({ id: boqs.id, facilityId: boqs.facilityId }).from(boqs).where(eq(boqs.id, d.boqId));
    if (!b) return fail("The selected BOQ no longer exists.");
    await requireFacilityAccess(b.facilityId, me);
  }
  if (d.issueDate && d.closingDate && d.closingDate < d.issueDate) return fail("The closing date must be after the issue date.");

  const scopeIds = ids(fd, "scope");
  if (scopeIds.length === 0) return fail("Tick at least one item to include in the RFQ.");
  const scopeCodes = (await db.select({ code: deviceTypes.code }).from(deviceTypes).where(inArray(deviceTypes.id, scopeIds))).map((r) => r.code);
  const allCount = Number(fd.get("scopeTotal") ?? 0);
  const scope = scopeCodes.length >= allCount ? null : scopeCodes; // everything ticked → no restriction

  const supplierIds = ids(fd, "supplierIds");
  const issue = d.intent === "issue";
  if (issue && supplierIds.length === 0) return fail("Invite at least one supplier before issuing the RFQ, or save it as a draft.");

  // Freeze the lines now: an RFQ sent to suppliers must not change if the BOQ is regenerated later.
  const snapshot = await deriveRfqLines({ projectId: d.projectId, boqId: d.boqId ?? null, notes: joinRfqNotes(null, scope) });
  if (snapshot.length === 0) return fail("None of the ticked items has a quantity in the BOQ or a specification. Tick other items.");

  const issueDate = d.issueDate ?? (issue ? todayISO() : null);
  let rfq: { id: number } | null = null;
  let number = "";
  for (let attempt = 0; attempt < 3 && !rfq; attempt++) {
    number = await nextNumber("RFQ", rfqs, rfqs.number);
    try {
      rfq = await db.transaction(async (tx) => {
        const [row] = await tx.insert(rfqs).values({
          projectId: d.projectId, number, title: d.title, status: issue ? "ISSUED" : "DRAFT", issueDate, closingDate: d.closingDate ?? null,
          boqId: d.boqId ?? null, notes: d.notes?.trim() || null,
        }).returning({ id: rfqs.id });
        await tx.insert(rfqLineRows).values(snapshot.map((l, i) => ({
          rfqId: row.id, deviceTypeId: l.deviceTypeId, quantity: l.quantity, boqLineIds: l.boqLineIds, departments: l.departments, sortOrder: i,
        })));
        return row;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // number taken by a concurrent RFQ: try the next one
    }
  }
  if (!rfq) return fail("Could not allocate an RFQ number. Please try again.");
  if (supplierIds.length) {
    await db.insert(rfqSuppliers).values(supplierIds.map((supplierId) => ({ rfqId: rfq.id, supplierId, invitedAt: issue ? issueDate : null })))
      .onConflictDoNothing();
  }
  await logActivity("rfq", rfq.id, "created", `${number} created${issue ? " and issued" : " as draft"} with ${scopeCodes.length} item${scopeCodes.length === 1 ? "" : "s"} and ${supplierIds.length} supplier${supplierIds.length === 1 ? "" : "s"}`);
  await logActivity("project", d.projectId, "rfq_created", `${number} ${issue ? "issued" : "drafted"}`);
  if (issue) await advanceProject(d.projectId, "RFQ", `${number} issued`);
  revalidatePath(`/procurement/${d.projectId}`);
  redirect(`/procurement/rfqs/${rfq.id}`);
}

export async function setRfqStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = z.object({ rfqId: idParam("RFQ missing"), status: z.enum(RFQ_STATUSES) }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const rfq = await rfqFor(parsed.data.rfqId, me);
  if (!rfq) return fail("This RFQ no longer exists.");
  const to = parsed.data.status;
  if (to === "ISSUED") {
    const invited = await db.select({ id: rfqSuppliers.id }).from(rfqSuppliers).where(eq(rfqSuppliers.rfqId, rfq.id));
    if (!invited.length) return fail("Invite at least one supplier before issuing the RFQ.");
  }
  const set: Partial<typeof rfqs.$inferInsert> = { status: to };
  if (to === "ISSUED" && !rfq.issueDate) set.issueDate = todayISO();
  await db.update(rfqs).set(set).where(eq(rfqs.id, rfq.id));
  if (to === "ISSUED") {
    await db.update(rfqSuppliers).set({ invitedAt: set.issueDate ?? rfq.issueDate ?? todayISO() })
      .where(and(eq(rfqSuppliers.rfqId, rfq.id)));
    await advanceProject(rfq.projectId, "RFQ", `${rfq.number} issued`);
  }
  if (to === "CLOSED") await advanceProject(rfq.projectId, "EVALUATION", `${rfq.number} closed for evaluation`);
  await logActivity("rfq", rfq.id, "status_changed", `${rfq.number} ${humanizeEnum(rfq.status).toLowerCase()} → ${humanizeEnum(to).toLowerCase()}`);
  revalidatePath(`/procurement/rfqs/${rfq.id}`);
  return { message: `RFQ is now ${humanizeEnum(to).toLowerCase()}.` };
}

export async function inviteSuppliers(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const rfqId = Number(fd.get("rfqId"));
  const rfq = await rfqFor(rfqId, me);
  if (!rfq) return fail("This RFQ no longer exists.");
  const supplierIds = ids(fd, "supplierIds");
  if (!supplierIds.length) return fail("Tick the suppliers to invite.");
  const invitedAt = rfq.status === "ISSUED" ? todayISO() : null;
  const inserted = await db.insert(rfqSuppliers).values(supplierIds.map((supplierId) => ({ rfqId, supplierId, invitedAt })))
    .onConflictDoNothing().returning({ supplierId: rfqSuppliers.supplierId });
  const names = inserted.length
    ? (await db.select({ name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, inserted.map((i) => i.supplierId)))).map((s) => s.name)
    : [];
  if (names.length) await logActivity("rfq", rfqId, "suppliers_invited", `Invited ${names.join(", ")}`);
  revalidatePath(`/procurement/rfqs/${rfqId}`);
  return { message: names.length ? `Invited ${names.length} supplier${names.length === 1 ? "" : "s"}.` : "Those suppliers were already invited." };
}

export async function updateInvitation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const id = Number(fd.get("invitationId"));
  const op = String(fd.get("op") ?? "");
  const [inv] = await db.select({ inv: rfqSuppliers, name: suppliers.name }).from(rfqSuppliers)
    .innerJoin(suppliers, eq(suppliers.id, rfqSuppliers.supplierId)).where(eq(rfqSuppliers.id, id));
  if (!inv) return fail("This invitation no longer exists.");
  if (!(await rfqFor(inv.inv.rfqId, me))) return fail("This RFQ no longer exists.");
  if (op === "remove") {
    await db.delete(rfqSuppliers).where(eq(rfqSuppliers.id, id));
    await logActivity("rfq", inv.inv.rfqId, "supplier_removed", `${inv.name} removed from the invitation list`);
  } else {
    const responded = op === "responded";
    await db.update(rfqSuppliers).set({ responded }).where(eq(rfqSuppliers.id, id));
    await logActivity("rfq", inv.inv.rfqId, "response", `${inv.name} marked as ${responded ? "responded" : "not responded"}`);
  }
  revalidatePath(`/procurement/rfqs/${inv.inv.rfqId}`);
  return null;
}

export async function updateRfqNotes(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const rfqId = Number(fd.get("rfqId"));
  const parsed = z.object({ title: reqStr("Enter a title", 300), closingDate: optDate("Enter the closing date as a date"), notes: optStr(4000) })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const rfq = await rfqFor(rfqId, me);
  if (!rfq) return fail("This RFQ no longer exists.");
  const { scope } = splitRfqNotes(rfq.notes);
  await db.update(rfqs).set({ title: parsed.data.title, closingDate: parsed.data.closingDate ?? null, notes: joinRfqNotes(parsed.data.notes, scope) })
    .where(eq(rfqs.id, rfqId));
  await logActivity("rfq", rfqId, "updated", "RFQ details updated");
  revalidatePath(`/procurement/rfqs/${rfqId}`);
  return { message: "Saved." };
}
