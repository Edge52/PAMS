"use server";
/**
 * Tender law pieces (wave 10): two-envelope opening (Law 182/2018 art. 23) and bonds (bid bond art. 16, performance
 * bond art. 40). The rates are those the plan set out; confirm them against the executive regulations in force.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bonds, offers, projects, purchaseOrders } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { EXCLUDED_OFFER_STATUSES } from "@/lib/procurement/labels";
import { logActivity } from "@/lib/server-utils";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);
const tab = (id: number) => `/procurement/${id}`;

async function project(fd: FormData) {
  const me = await requirePermission("procurement.edit");
  const id = Number(fd.get("projectId"));
  const [p] = Number.isInteger(id) ? await db.select().from(projects).where(eq(projects.id, id)) : [];
  if (p) await requireFacilityAccess(p.facilityId, me);
  return { me, p };
}

export async function setEnvelopesAction(_: FormState, fd: FormData): Promise<FormState> {
  const { me, p } = await project(fd);
  if (!p) return { error: "That project no longer exists." };
  if (p.technicalOpenedAt) return { error: "The envelopes are already open; the method can't change now." };
  const two = fd.get("two") === "1";
  await db.update(projects).set({ twoEnvelope: two }).where(eq(projects.id, p.id));
  await logActivity("project", p.id, "envelopes", two ? "Set as a two-envelope tender" : "Set as a single-envelope tender", me.name);
  revalidatePath(tab(p.id));
  return { ok: two ? "Two envelopes: prices stay sealed until the technical evaluation is done." : "Single envelope." };
}

export async function openEnvelopesAction(_: FormState, fd: FormData): Promise<FormState> {
  const { me, p } = await project(fd);
  if (!p) return { error: "That project no longer exists." };
  const which = String(fd.get("which"));
  if (which === "technical") {
    if (p.technicalOpenedAt) return { error: "The technical envelopes are already open." };
    await db.update(projects).set({ technicalOpenedAt: new Date() }).where(eq(projects.id, p.id));
    await logActivity("project", p.id, "envelopes", "Technical envelopes opened", me.name);
  } else {
    if (!p.twoEnvelope) return { error: "This is a single-envelope tender." };
    if (!p.technicalOpenedAt) return { error: "Open the technical envelopes first." };
    if (p.financialOpenedAt) return { error: "The financial envelopes are already open." };
    const live = (await db.select({ id: offers.id, ts: offers.technicalScore, status: offers.status }).from(offers).where(eq(offers.projectId, p.id)))
      .filter((o) => !EXCLUDED_OFFER_STATUSES.includes(o.status));
    const todo = live.filter((o) => o.ts == null).length;
    if (todo) return { error: `${todo} offer${todo === 1 ? " has" : "s have"} no technical evaluation yet. Record their compliance (or reject them) before opening the prices.` };
    await db.update(projects).set({ financialOpenedAt: new Date() }).where(eq(projects.id, p.id));
    await logActivity("project", p.id, "envelopes", `Financial envelopes opened for ${live.length} offer${live.length === 1 ? "" : "s"}`, me.name);
  }
  revalidatePath(tab(p.id));
  return { ok: which === "technical" ? "Technical envelopes opened. Record each offer's compliance." : "Financial envelopes opened. Prices are now visible in the comparison." };
}

export async function addBondAction(_: FormState, fd: FormData): Promise<FormState> {
  const { me, p } = await project(fd);
  if (!p) return { error: "That project no longer exists." };
  const kind = String(fd.get("kind")) as "BID" | "PERFORMANCE" | "ADVANCE_PAYMENT";
  if (!["BID", "PERFORMANCE", "ADVANCE_PAYMENT"].includes(kind)) return { error: "Choose the kind of bond." };
  const offerId = Number(fd.get("offerId")) || null, poId = Number(fd.get("poId")) || null;
  let supplierId: number | null = null;
  if (offerId) { const [o] = await db.select({ s: offers.supplierId }).from(offers).where(and(eq(offers.id, offerId), eq(offers.projectId, p.id))); supplierId = o?.s ?? null; }
  if (poId) { const [o] = await db.select({ s: purchaseOrders.supplierId }).from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.projectId, p.id))); supplierId = o?.s ?? supplierId; }
  if (!supplierId) return { error: kind === "BID" ? "Choose the offer the bid bond comes with." : "Choose the purchase order the bond secures." };
  const amount = Number(str(fd, "amount").replace(/,/g, "")), currency = (str(fd, "currency", 3) || p.currency).toUpperCase();
  const issueDate = str(fd, "issueDate", 10) || null, expiryDate = str(fd, "expiryDate", 10) || null;
  if (!(amount > 0)) return { error: "Enter the bond amount." };
  if ((issueDate && !DATE.test(issueDate)) || (expiryDate && !DATE.test(expiryDate))) return { error: "Enter the dates as dates." };
  await db.insert(bonds).values({ projectId: p.id, supplierId, offerId, poId, kind, bank: str(fd, "bank", 200) || null, reference: str(fd, "reference", 120) || null, amount: amount.toFixed(2), currency, issueDate, expiryDate, notes: str(fd, "notes", 1000) || null });
  await logActivity("project", p.id, "bond", `${kind.toLowerCase().replace("_", " ")} bond recorded: ${currency} ${amount.toLocaleString("en")}`, me.name);
  revalidatePath(tab(p.id));
  return { ok: "Bond recorded." };
}

export async function setBondStatusAction(_: FormState, fd: FormData): Promise<FormState> {
  const { me, p } = await project(fd);
  if (!p) return { error: "That project no longer exists." };
  const id = Number(fd.get("bondId")), status = String(fd.get("status")) as "RELEASED" | "CALLED" | "HELD";
  if (!["RELEASED", "CALLED", "HELD"].includes(status)) return { error: "Choose what happened to the bond." };
  const r = await db.update(bonds).set({ status, releasedOn: status === "HELD" ? null : new Date().toISOString().slice(0, 10) }).where(and(eq(bonds.id, id), eq(bonds.projectId, p.id))).returning({ id: bonds.id });
  if (!r.length) return { error: "That bond no longer exists." };
  await logActivity("project", p.id, "bond", `Bond ${status.toLowerCase()}`, me.name);
  revalidatePath(tab(p.id));
  return { ok: status === "RELEASED" ? "Bond released to the supplier." : status === "CALLED" ? "Bond called." : "Bond held again." };
}
