"use server";
/**
 * Budgets and supplier invoices (wave 10). A PO commits against a budget line; an invoice is matched against what the
 * PO ordered and what was received, then approved (with a reason when it differs) and marked paid.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { budgetLines, invoiceLines, invoices, purchaseOrders } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { notifyRole } from "@/lib/notifications";
import { budgetCrossing, matchInvoice } from "@/lib/procurement/money";
import { budgetRows, matchLinesFor, poValues } from "@/lib/procurement/money-server";
import { fxFactors } from "@/lib/procurement/server";
import { logActivity, nextNumber } from "@/lib/server-utils";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const go = (path: string, msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg)}`);
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);

/* ── Budget lines ── */

export async function saveBudgetLineAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("budgets.edit");
  const id = Number(fd.get("id")) || null;
  const facilityId = Number(fd.get("facilityId")), year = Number(fd.get("year"));
  const name = str(fd, "name", 200), amount = Number(str(fd, "amount").replace(/,/g, ""));
  const currency = (str(fd, "currency", 3) || "EGP").toUpperCase();
  if (!Number.isInteger(facilityId) || facilityId <= 0) return { error: "Choose a hospital." };
  await requireFacilityAccess(facilityId, me);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "Enter the budget year." };
  if (name.length < 2) return { error: "Name the budget line, e.g. “Imaging equipment”." };
  if (!(amount >= 0 && amount < 1e13)) return { error: "Enter the amount." };
  const v = { facilityId, year, name, amount: amount.toFixed(2), currency, departmentId: Number(fd.get("departmentId")) || null, projectId: Number(fd.get("projectId")) || null, notes: str(fd, "notes", 1000) || null };
  if (id) await db.update(budgetLines).set(v).where(eq(budgetLines.id, id));
  else await db.insert(budgetLines).values(v);
  await logActivity("facility", facilityId, "budget line", `${year} ${name}: ${currency} ${amount.toLocaleString("en")}`, me.name);
  revalidatePath("/procurement/budgets");
  return { ok: id ? "Budget line saved." : `${name} added.` };
}

/** Put a PO against a budget line (or take it off). Warns finance when the PO takes the line past 80 % or 100 %. */
export async function setPoBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("po.create");
  const poId = Number(fd.get("poId")), lineId = Number(fd.get("budgetLineId")) || null;
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) return { error: "That purchase order no longer exists." };
  await requireFacilityAccess(po.facilityId, me);
  if (!lineId) { await db.update(purchaseOrders).set({ budgetLineId: null }).where(eq(purchaseOrders.id, po.id)); revalidatePath(`/procurement/purchase-orders/${po.id}`); return { ok: "Taken off the budget." }; }
  const [line] = await db.select().from(budgetLines).where(eq(budgetLines.id, lineId));
  if (!line || (po.facilityId != null && line.facilityId !== po.facilityId)) return { error: "Choose a budget line of this PO's hospital." };
  const [before] = await budgetRows([line]);
  const fx = await fxFactors([po.currency], line.currency);
  const value = (await poValues([po.id])).get(po.id) ?? 0;
  const inLine = po.budgetLineId === line.id;
  const crossing = !inLine && fx[po.currency] != null ? budgetCrossing(Number(line.amount), before.used + before.requested, value * fx[po.currency]!) : null;
  await db.update(purchaseOrders).set({ budgetLineId: line.id }).where(eq(purchaseOrders.id, po.id));
  await logActivity("po", po.id, "budget", `Charged to ${line.year} ${line.name}`, me.name);
  if (crossing) {
    await notifyRole("FINANCE", { kind: "budget_warning", title: `${line.year} ${line.name}: ${crossing === "100" ? "over budget" : "past 80 %"} with ${po.number}`,
      body: `Remaining before this PO: ${line.currency} ${Math.round(before.remaining).toLocaleString("en")}.`, href: `/procurement/budgets?facilityId=${line.facilityId}&year=${line.year}`, dedupeKey: `budget:${line.id}:${crossing}` }, line.facilityId);
  }
  revalidatePath(`/procurement/purchase-orders/${po.id}`);
  return crossing ? { error: `Charged to ${line.name}, which is now ${crossing === "100" ? "over budget" : "past 80 % of its budget"}. Finance has been told.` } : { ok: `Charged to ${line.year} ${line.name}.` };
}

/* ── Invoices ── */

function enteredLines(fd: FormData) {
  const m = new Map<number, { quantity: number; unitPrice: number }>();
  for (const [k, v] of fd.entries()) {
    const q = /^qty_(\d+)$/.exec(k); if (!q) continue;
    const id = Number(q[1]), quantity = Number(v || 0), unitPrice = Number(fd.get(`price_${id}`) || 0);
    if (Number.isInteger(quantity) && quantity > 0 && unitPrice >= 0) m.set(id, { quantity, unitPrice });
  }
  return m;
}

export async function createInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("invoices.edit");
  const poId = Number(fd.get("poId"));
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) return { error: "Choose a purchase order." };
  await requireFacilityAccess(po.facilityId, me);
  if (["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(po.status)) return { error: "Invoices are recorded against approved or issued purchase orders." };
  const supplierInvoiceNo = str(fd, "supplierInvoiceNo", 64), invoiceDate = str(fd, "invoiceDate", 10), dueDate = str(fd, "dueDate", 10) || null;
  if (!supplierInvoiceNo) return { error: "Enter the supplier's invoice number." };
  if (!DATE.test(invoiceDate)) return { error: "Enter the invoice date." };
  if (dueDate && !DATE.test(dueDate)) return { error: "Enter the due date as a date." };
  const [dup] = await db.select({ n: invoices.number }).from(invoices).where(and(eq(invoices.supplierId, po.supplierId), eq(invoices.supplierInvoiceNo, supplierInvoiceNo)));
  if (dup) return { error: `This supplier's invoice ${supplierInvoiceNo} is already recorded as ${dup.n}.` };
  const entered = enteredLines(fd);
  if (!entered.size) return { error: "Enter the quantity invoiced on at least one line." };
  const match = matchInvoice((await matchLinesFor(po.id, entered)).filter((l) => l.quantity > 0));
  const inv = await db.transaction(async (tx) => {
    const number = await nextNumber("INV", invoices, invoices.number, tx);
    const [row] = await tx.insert(invoices).values({ number, supplierInvoiceNo, poId: po.id, supplierId: po.supplierId, invoiceDate, dueDate, currency: po.currency,
      status: match.ok ? "MATCHED" : "EXCEPTION", notes: str(fd, "notes", 2000) || null, createdByName: me.name }).returning({ id: invoices.id, number: invoices.number });
    await tx.insert(invoiceLines).values([...entered].map(([poLineId, l]) => ({ invoiceId: row.id, poLineId, quantity: l.quantity, unitPrice: l.unitPrice.toFixed(2) })));
    await logActivity("po", po.id, "invoice", `${row.number} (supplier's ${supplierInvoiceNo}) recorded: ${match.ok ? "matches" : "differs from"} the PO and goods received`, me.name, tx);
    return row;
  });
  await notifyRole("FINANCE", { kind: "invoice_received", title: `${inv.number} from ${po.number}: ${match.ok ? "ready to approve" : "differences to check"}`, href: `/procurement/invoices/${inv.id}`, dedupeKey: `invoice:${inv.id}` }, po.facilityId);
  revalidatePath("/procurement/invoices");
  return go(`/procurement/invoices/${inv.id}`, match.ok ? `${inv.number} recorded. It matches the PO and goods received.` : `${inv.number} recorded with differences: check them before approving.`);
}

export async function decideInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("invoices.approve");
  const id = Number(fd.get("invoiceId")), decision = String(fd.get("decision")), note = str(fd, "note", 1000);
  const [inv] = await db.select({ i: invoices, facilityId: purchaseOrders.facilityId }).from(invoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId)).where(eq(invoices.id, id));
  if (!inv) return { error: "That invoice no longer exists." };
  await requireFacilityAccess(inv.facilityId, me);
  if (!["MATCHED", "EXCEPTION"].includes(inv.i.status)) return { error: "Only invoices waiting for a decision can be approved or rejected." };
  if (decision === "reject") {
    if (!note) return { error: "Say why the invoice is rejected; the supplier will need to know." };
    await db.update(invoices).set({ status: "REJECTED", decisionNote: note, approvedByName: me.name, approvedAt: new Date() }).where(eq(invoices.id, id));
    await logActivity("po", inv.i.poId, "invoice rejected", `${inv.i.number}: ${note}`, me.name);
    revalidatePath(`/procurement/invoices/${id}`);
    return { ok: "Invoice rejected." };
  }
  // Re-check against today's receipts before approving.
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
  const match = matchInvoice((await matchLinesFor(inv.i.poId, new Map(lines.map((l) => [l.poLineId, { quantity: l.quantity, unitPrice: Number(l.unitPrice) }])), id)).filter((l) => l.quantity > 0));
  if (!match.ok && !note) return { error: "It still differs from the PO or goods received. Give the reason for approving it anyway." };
  await db.update(invoices).set({ status: "APPROVED", decisionNote: note || null, approvedByName: me.name, approvedAt: new Date() }).where(eq(invoices.id, id));
  await logActivity("po", inv.i.poId, "invoice approved", `${inv.i.number}${!match.ok ? ` despite differences: ${note}` : ""}`, me.name);
  revalidatePath(`/procurement/invoices/${id}`);
  return { ok: "Invoice approved for payment." };
}

export async function markPaidAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("invoices.approve");
  const id = Number(fd.get("invoiceId")), paidAt = str(fd, "paidAt", 10), ref = str(fd, "paymentReference", 120);
  const [inv] = await db.select({ i: invoices, facilityId: purchaseOrders.facilityId }).from(invoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId)).where(eq(invoices.id, id));
  if (!inv) return { error: "That invoice no longer exists." };
  await requireFacilityAccess(inv.facilityId, me);
  if (inv.i.status !== "APPROVED") return { error: "Approve the invoice before recording payment." };
  if (!DATE.test(paidAt)) return { error: "Enter the payment date." };
  await db.update(invoices).set({ status: "PAID", paidAt, paymentReference: ref || null }).where(eq(invoices.id, id));
  await logActivity("po", inv.i.poId, "invoice paid", `${inv.i.number} paid ${paidAt}${ref ? ` (${ref})` : ""}`, me.name);
  revalidatePath(`/procurement/invoices/${id}`);
  return { ok: "Payment recorded." };
}
