"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { departments, deliveries, offerLines, offers, poLines, projects, purchaseOrders, suppliers } from "@/db/schema";
import { formatDate, formatMoney, round2, todayISO } from "@/lib/format";
import { convert, logActivity, nextNumber } from "@/lib/server-utils";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { cancelApproval, startApproval } from "@/lib/approvals/server";
import { fail, formObject, idParam, isUniqueViolation, optDate, optInt, optStr, reqDate, reqStr, zodErrors, type ActionState } from "@/lib/procurement/forms";
import { humanizeEnum, INCOTERMS } from "@/lib/procurement/labels";
import { canSubmit, canTransition, isEditable, transitionPermission, type PoStatus, PO_STATUSES } from "@/lib/procurement/po-status";
import { parseSerials, validateOrderQty } from "@/lib/procurement/receipt";
import { createMissingAssets, receiveGoods } from "@/lib/procurement/receiving";
import { netUnitPrice } from "@/lib/procurement/scoring";
import { advanceProject } from "@/lib/procurement/server";

const blankToUndef = (v: unknown) => (v === "" ? undefined : v);
const poHeader = z.object({
  issueDate: optDate("Enter the issue date as a date"),
  expectedDelivery: optDate("Enter the expected delivery as a date"),
  paymentTerms: optStr(500),
  incoterm: z.preprocess(blankToUndef, z.enum(INCOTERMS, { error: "Choose an Incoterm from the list" }).optional()),
  warrantyMonths: optInt("Warranty must be a whole number of months", 0, 240),
  notes: optStr(4000),
});

/** Units of each offer line already on other (non-cancelled) purchase orders. */
async function alreadyOrdered(offerLineIds: number[], excludePoId?: number) {
  if (!offerLineIds.length) return new Map<number, number>();
  const rows = await db.select({ id: poLines.offerLineId, q: sql<number>`sum(${poLines.quantity})::int` }).from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(and(inArray(poLines.offerLineId, offerLineIds), ne(purchaseOrders.status, "CANCELLED"), excludePoId ? ne(purchaseOrders.id, excludePoId) : undefined))
    .groupBy(poLines.offerLineId);
  return new Map(rows.map((r) => [r.id as number, r.q]));
}

export async function createPurchaseOrder(offerId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("po.create");
  const parsed = poHeader.extend({ intent: z.enum(["draft", "submit"]).default("draft") }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const h = parsed.data;
  const [row] = await db.select({ offer: offers, project: projects, supplier: suppliers.name }).from(offers)
    .innerJoin(projects, eq(projects.id, offers.projectId)).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.id, offerId));
  if (!row) return fail("This offer no longer exists.");
  await requireFacilityAccess(row.project.facilityId, me);
  if (row.offer.status !== "AWARDED") return fail("Award the offer before raising a purchase order against it.");
  if (!row.offer.awardApprovedOn) return fail("The award of this offer hasn't been approved by the competent authority yet. Recommend the award and wait for the approval before raising a purchase order.");
  if (h.issueDate && h.expectedDelivery && h.expectedDelivery < h.issueDate) return fail("Expected delivery must be after the issue date.");

  const lines = await db.select().from(offerLines).where(eq(offerLines.offerId, offerId)).orderBy(offerLines.id);
  const ordered = await alreadyOrdered(lines.map((l) => l.id));
  const deptIds = new Set(row.project.facilityId
    ? (await db.select({ id: departments.id }).from(departments).where(eq(departments.facilityId, row.project.facilityId))).map((d) => d.id)
    : []);

  const errors: string[] = [];
  const chosen: (typeof poLines.$inferInsert)[] = [];
  for (const l of lines) {
    if (fd.get(`include_${l.id}`) !== "on") continue;
    const qty = Number(fd.get(`qty_${l.id}`));
    const remaining = l.quantity - (ordered.get(l.id) ?? 0);
    const err = validateOrderQty(qty, remaining);
    if (err) { errors.push(`${l.description}: ${err.replace("(the quantity offered)", remaining < l.quantity ? "(not yet ordered)" : "(the quantity offered)")}`); continue; }
    if (qty === 0) continue;
    const dept = Number(fd.get(`dept_${l.id}`));
    chosen.push({
      offerLineId: l.id, deviceTypeId: l.deviceTypeId, description: l.description, manufacturer: l.manufacturer, model: l.model, quantity: qty,
      unitPrice: String(round2(netUnitPrice(Number(l.unitPrice), l.discountPct))),
      destinationDepartmentId: deptIds.has(dept) ? dept : null, poId: 0,
    });
  }
  if (errors.length) return fail(...errors);
  if (!chosen.length) return fail("Tick at least one line and enter a quantity to order.");

  const submit = h.intent === "submit";
  let poId = 0;
  for (let attempt = 0; attempt < 3 && !poId; attempt++) {
    const number = await nextNumber("PO", purchaseOrders, purchaseOrders.number);
    try {
      poId = await db.transaction(async (tx) => {
        const [po] = await tx.insert(purchaseOrders).values({
          number, projectId: row.project.id, supplierId: row.offer.supplierId, offerId, facilityId: row.project.facilityId,
          status: "DRAFT", issueDate: h.issueDate ?? null, expectedDelivery: h.expectedDelivery ?? null,
          currency: row.offer.currency, incoterm: h.incoterm ?? row.offer.incoterm, paymentTerms: h.paymentTerms ?? row.offer.paymentTerms,
          warrantyMonths: h.warrantyMonths ?? row.offer.warrantyMonths, notes: h.notes ?? null,
        }).returning({ id: purchaseOrders.id });
        await tx.insert(poLines).values(chosen.map((c) => ({ ...c, poId: po.id })));
        return po.id;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // number taken by a concurrent PO: try the next one
    }
  }
  if (!poId) return fail("Could not allocate a purchase order number. Please try again.");
  const value = chosen.reduce((s, c) => s + c.quantity * Number(c.unitPrice), 0);
  const [po] = await db.select({ number: purchaseOrders.number }).from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  await logActivity("po", poId, "created", `${po.number} drafted to ${row.supplier} from offer ${row.offer.reference}: ${chosen.length} lines, ${formatMoney(value, row.offer.currency)}`);
  await logActivity("offer", offerId, "po_created", `Purchase order ${po.number} raised`);
  await logActivity("project", row.project.id, "po_created", `${po.number} to ${row.supplier} (${formatMoney(value, row.offer.currency)})`);
  await advanceProject(row.project.id, "AWARDED", `purchase order ${po.number} raised`);
  let notice = "";
  if (submit) {
    const res = await submitForApproval(poId, me);
    notice = res.ok ? `&submitted=1` : `&submitError=${encodeURIComponent(res.error)}`;
  }
  revalidatePath("/procurement/purchase-orders");
  revalidatePath(`/procurement/${row.project.id}`);
  redirect(`/procurement/purchase-orders/${poId}?created=1${notice}`);
}

/** DRAFT → PENDING_APPROVAL and start the approval chain (amount converted to EGP for the thresholds). */
async function submitForApproval(poId: number, me: CurrentUser): Promise<{ ok: true; auto: boolean } | { ok: false; error: string }> {
  const [row] = await db.select({ po: purchaseOrders, supplier: suppliers.name }).from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.id, poId));
  if (!row) return { ok: false, error: "This purchase order no longer exists." };
  const lines = await db.select({ quantity: poLines.quantity, receivedQty: poLines.receivedQty, unitPrice: poLines.unitPrice }).from(poLines).where(eq(poLines.poId, poId));
  if (!canSubmit(row.po.status as PoStatus, lines)) {
    return { ok: false, error: row.po.status === "DRAFT" ? "Add at least one line before submitting." : `A purchase order that is ${humanizeEnum(row.po.status).toLowerCase()} can't be submitted again.` };
  }
  const value = round2(lines.reduce((s, l) => s + l.quantity * Number(l.unitPrice), 0));
  const egp = await convert(value, row.po.currency, "EGP");
  if (egp == null) return { ok: false, error: `No exchange rate from ${row.po.currency} to EGP is stored, so the approval thresholds can't be applied. Add the rate first.` };
  const moved = await db.update(purchaseOrders).set({ status: "PENDING_APPROVAL" })
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.status, "DRAFT"))).returning({ id: purchaseOrders.id });
  if (!moved.length) return { ok: false, error: "Someone changed this purchase order a moment ago. Reload the page." };
  try {
    const res = await startApproval({
      entity: "PO", entityId: poId, title: `${row.po.number} · ${row.supplier} · ${formatMoney(value, row.po.currency, { compact: value >= 1e6 })}`,
      href: `/procurement/purchase-orders/${poId}`, amountEgp: egp, facilityId: row.po.facilityId,
    }, me);
    return { ok: true, auto: res.status === "APPROVED" };
  } catch (e) {
    await db.update(purchaseOrders).set({ status: "DRAFT" }).where(eq(purchaseOrders.id, poId));
    return { ok: false, error: e instanceof Error ? e.message : "Could not start the approval." };
  }
}

async function loadPoForAction(poId: number, me: CurrentUser) {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (po) await requireFacilityAccess(po.facilityId, me);
  return po ?? null;
}

export async function submitPurchaseOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("po.create");
  const poId = Number(fd.get("poId"));
  const po = await loadPoForAction(poId, me);
  if (!po) return fail("This purchase order no longer exists.");
  const res = await submitForApproval(poId, me);
  if (!res.ok) return fail(res.error);
  revalidatePath(`/procurement/purchase-orders/${poId}`);
  revalidatePath("/procurement/purchase-orders");
  revalidatePath("/approvals");
  return { message: res.auto ? "No approval rule applies to this order, so it is approved and ready to issue." : "Submitted for approval. The approvers have been notified." };
}

export async function withdrawPurchaseOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("po.create");
  const poId = Number(fd.get("poId"));
  const po = await loadPoForAction(poId, me);
  if (!po) return fail("This purchase order no longer exists.");
  if (po.status !== "PENDING_APPROVAL") return fail("Only an order waiting for approval can be withdrawn.");
  const done = await cancelApproval("PO", poId, "withdrawn by the requester to make changes", me);
  if (!done) return fail("The approval has already finished. Reload the page.");
  revalidatePath(`/procurement/purchase-orders/${poId}`);
  revalidatePath("/approvals");
  return { message: "Withdrawn. The order is a draft again: edit it and submit it when ready." };
}

export async function setPoStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  // The permission depends on the target status (issue → po.issue, cancel → po.create); checked right after parsing.
  const parsed = z.object({ poId: idParam("Purchase order missing"), status: z.enum(PO_STATUSES as [PoStatus, ...PoStatus[]]) }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const { poId, status } = parsed.data;
  const me = await requirePermission(transitionPermission(status));
  const po = await loadPoForAction(poId, me);
  if (!po) return fail("This purchase order no longer exists.");
  const lines = await db.select({ quantity: poLines.quantity, receivedQty: poLines.receivedQty }).from(poLines).where(eq(poLines.poId, poId));
  if (!canTransition(po.status as PoStatus, status, lines)) {
    return fail(status === "CANCELLED" ? "An order with goods already received cannot be cancelled. Close it instead."
      : status === "ISSUED" && po.status !== "APPROVED" ? "A purchase order can only be issued once it is approved. Submit it for approval first."
      : `A purchase order that is ${humanizeEnum(po.status).toLowerCase()} cannot be set to ${humanizeEnum(status).toLowerCase()}.`);
  }
  // Law 182/2018 art. 39: the contract follows the acceptance notice, which follows the complaint window. Drafting and
  // approving the PO can start earlier; sending it to the supplier can't.
  if (status === "ISSUED" && po.offerId) {
    const [o] = await db.select({ complaintUntil: offers.complaintUntil, acceptedOn: offers.acceptedOn, reference: offers.reference })
      .from(offers).where(eq(offers.id, po.offerId));
    if (o && !o.acceptedOn) {
      return fail(o.complaintUntil && o.complaintUntil >= todayISO()
        ? `The complaint period on this award runs until ${formatDate(o.complaintUntil)} (Law 182/2018, art. 39). Issue the PO after it ends and the acceptance notice is sent.`
        : `Record that the acceptance notice was sent to the supplier (on offer ${o.reference}) before issuing the PO (Law 182/2018, art. 39).`);
    }
  }
  if (po.status === "PENDING_APPROVAL" && status === "CANCELLED") await cancelApproval("PO", poId, "purchase order cancelled", me, false);
  const set: Partial<typeof purchaseOrders.$inferInsert> = { status };
  if (status === "ISSUED" && !po.issueDate) set.issueDate = todayISO();
  await db.update(purchaseOrders).set(set).where(eq(purchaseOrders.id, poId));
  await logActivity("po", poId, "status_changed", `${po.number}: ${humanizeEnum(po.status).toLowerCase()} → ${humanizeEnum(status).toLowerCase()}`);
  revalidatePath(`/procurement/purchase-orders/${poId}`);
  revalidatePath("/procurement/purchase-orders");
  revalidatePath("/approvals");
  return { message: `Purchase order is now ${humanizeEnum(status).toLowerCase()}.` };
}

export async function updatePurchaseOrder(poId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("po.create");
  const parsed = poHeader.safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const po = await loadPoForAction(poId, me);
  if (!po) return fail("This purchase order no longer exists.");
  if (po.status === "CANCELLED" || po.status === "CLOSED") return fail(`A ${humanizeEnum(po.status).toLowerCase()} purchase order can't be changed.`);
  const h = parsed.data;
  const draft = isEditable(po.status as PoStatus);
  const lines = await db.select().from(poLines).where(eq(poLines.poId, poId));
  const ordered = await alreadyOrdered(lines.map((l) => l.offerLineId).filter((x): x is number => x != null), poId);
  const offered = lines.some((l) => l.offerLineId)
    ? new Map((await db.select({ id: offerLines.id, q: offerLines.quantity }).from(offerLines)
      .where(inArray(offerLines.id, lines.map((l) => l.offerLineId).filter((x): x is number => x != null)))).map((r) => [r.id, r.q]))
    : new Map<number, number>();
  const deptIds = new Set(po.facilityId ? (await db.select({ id: departments.id }).from(departments).where(eq(departments.facilityId, po.facilityId))).map((d) => d.id) : []);

  const errors: string[] = [];
  const updates: { id: number; quantity: number; dept: number | null }[] = [];
  for (const l of lines) {
    const dept = Number(fd.get(`dept_${l.id}`));
    let quantity = l.quantity;
    if (draft && fd.has(`qty_${l.id}`)) {
      quantity = Number(fd.get(`qty_${l.id}`));
      const max = l.offerLineId ? (offered.get(l.offerLineId) ?? l.quantity) - (ordered.get(l.offerLineId) ?? 0) : Infinity;
      const err = validateOrderQty(quantity, max);
      if (err || quantity < 1) { errors.push(`${l.description}: ${err ?? "quantity must be at least 1 (remove the line by cancelling and re-raising the order)."}`); continue; }
    }
    updates.push({ id: l.id, quantity, dept: deptIds.has(dept) ? dept : null });
  }
  if (errors.length) return fail(...errors);
  const RACED = "Someone submitted this purchase order for approval a moment ago, so your changes weren't saved. Reload the page.";
  try {
    await db.transaction(async (tx) => {
      const saved = await tx.update(purchaseOrders).set({
        expectedDelivery: h.expectedDelivery ?? null, notes: h.notes ?? null,
        // Commercial terms are part of what was approved: only drafts can change them.
        ...(draft ? { issueDate: h.issueDate ?? null, incoterm: h.incoterm ?? null, warrantyMonths: h.warrantyMonths ?? null, paymentTerms: h.paymentTerms ?? null } : {}),
      }).where(draft ? and(eq(purchaseOrders.id, poId), eq(purchaseOrders.status, "DRAFT")) : eq(purchaseOrders.id, poId))
        .returning({ id: purchaseOrders.id });
      // A submit that slipped in between our read and this write: roll back rather than change what's being approved.
      if (!saved.length) throw new Error(RACED);
      for (const u of updates) await tx.update(poLines).set({ quantity: u.quantity, destinationDepartmentId: u.dept }).where(eq(poLines.id, u.id));
    });
  } catch (e) {
    if (e instanceof Error && e.message === RACED) return fail(RACED);
    throw e;
  }
  await logActivity("po", poId, "updated", `${po.number} details updated`);
  revalidatePath(`/procurement/purchase-orders/${poId}`);
  return { message: "Saved." };
}

export async function recordDelivery(poId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("goods.receive");
  const parsed = z.object({
    reference: reqStr("Enter the delivery note or GRN number", 64),
    deliveryDate: reqDate("Enter the delivery date"),
    receivedBy: optStr(200),
    notes: optStr(2000),
  }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  if (parsed.data.deliveryDate > todayISO()) return fail("The delivery date cannot be in the future.");
  const po = await loadPoForAction(poId, me);
  if (!po) return fail("This purchase order no longer exists.");
  if (!["ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED"].includes(po.status)) {
    return fail(["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(po.status) ? "Issue the purchase order before receiving goods against it." : `Goods cannot be received on a ${humanizeEnum(po.status).toLowerCase()} order.`);
  }
  const lineIds = (await db.select({ id: poLines.id }).from(poLines).where(eq(poLines.poId, poId))).map((l) => l.id);
  const input = lineIds.map((id) => {
    const raw = fd.get(`qty_${id}`);
    const qty = raw === null || raw === "" ? 0 : Number(raw);
    return { poLineId: id, qty, serials: parseSerials(fd.get(`serials_${id}`) as string | null) };
  });
  const res = await receiveGoods(poId, {
    reference: parsed.data.reference, deliveryDate: parsed.data.deliveryDate, receivedBy: parsed.data.receivedBy ?? null, notes: parsed.data.notes ?? null,
  }, input);
  if (!res.ok) return fail(...res.errors);
  revalidatePath(`/procurement/purchase-orders/${poId}`);
  revalidatePath("/procurement/purchase-orders");
  revalidatePath("/assets");
  redirect(`/procurement/purchase-orders/${poId}?received=${res.deliveryId}&assets=${res.assetsCreated}${res.assetError ? "&assetError=1" : ""}`);
}

export async function retryAssets(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("goods.receive");
  const poId = Number(fd.get("poId"));
  if (!(await loadPoForAction(poId, me))) return fail("This purchase order no longer exists.");
  const ds = await db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.poId, poId));
  let n = 0;
  try {
    for (const d of ds) n += await createMissingAssets(d.id);
  } catch (e) {
    console.error(e);
    return fail("Registering the assets failed again. Check that the project has a facility and the device types still exist.");
  }
  revalidatePath(`/procurement/purchase-orders/${poId}`);
  return { message: n ? `Registered ${n} asset${n === 1 ? "" : "s"}.` : "Every received unit already has an asset." };
}
