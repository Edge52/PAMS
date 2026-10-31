"use server";
/**
 * Device condemnation and disposal. Biomedical proposes (assets.dispose); the approvals engine (entity DISPOSAL)
 * decides — its effect condemns the device; biomedical then records how it left the hospital.
 */
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, disposals, recallAssets, workOrders } from "@/db/schema";
import { cancelApproval, startApproval } from "@/lib/approvals/server";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { firstError, formObject, isoDate, num, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { DISPOSAL_METHODS, DISPOSAL_REASONS } from "@/lib/assets/disposal";
import { convert, logActivity, nextNumber } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";

const path = (did: number) => `/assets/disposals/${did}`;
const go = (did: number, msg: string): never => redirect(`${path(did)}?notice=${encodeURIComponent(msg)}`);
const OPEN_JOB = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;

/** Submit to the approvals engine; on failure (no approver can decide) the request stays a draft with the reason. */
async function submit(d: { id: number; number: string; facilityId: number; estimatedValue: string | null; currency: string | null; tag: string }, me: CurrentUser) {
  await db.update(disposals).set({ status: "PENDING_APPROVAL" }).where(eq(disposals.id, d.id));
  try {
    const amountEgp = d.estimatedValue != null ? await convert(Number(d.estimatedValue), d.currency ?? "EGP", "EGP") : null;
    const res = await startApproval({ entity: "DISPOSAL", entityId: d.id, title: `Dispose of ${d.tag} (${d.number})`, href: path(d.id), amountEgp, facilityId: d.facilityId }, me);
    return { ok: true as const, auto: res.status === "APPROVED" };
  } catch (e) {
    await db.update(disposals).set({ status: "DRAFT" }).where(eq(disposals.id, d.id));
    return { ok: false as const, error: e instanceof Error ? e.message : "Could not start the approval." };
  }
}

const ProposeSchema = z.object({
  assetId: reqId("Device"), reason: oneOf("Reason", DISPOSAL_REASONS), method: oneOf("Disposal method", DISPOSAL_METHODS),
  justification: reqText("Justification", 4000), estimatedValue: num("Residual value", 0, 1e10), currency: text(3),
});

export async function proposeDisposalAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.dispose");
  const p = ProposeSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status }).from(assets).where(eq(assets.id, d.assetId));
  if (!a) return { error: "That device no longer exists." };
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return { error: `${a.tag} has already been disposed of.` };
  const [open] = await db.select({ number: disposals.number }).from(disposals)
    .where(and(eq(disposals.assetId, a.id), inArray(disposals.status, ["DRAFT", "PENDING_APPROVAL", "APPROVED"]))).limit(1);
  if (open) return { error: `${a.tag} already has disposal request ${open.number}.` };
  const row = await db.transaction(async (tx) => {
    const number = await nextNumber("DSP", disposals, disposals.number, tx);
    const [r] = await tx.insert(disposals).values({
      number, assetId: a.id, facilityId: a.facilityId, reason: d.reason ?? "BEYOND_REPAIR", method: d.method ?? "SCRAP", justification: d.justification,
      estimatedValue: d.estimatedValue != null ? String(d.estimatedValue) : null, currency: d.estimatedValue != null ? (d.currency ?? "EGP").toUpperCase() : null,
      requestedById: me.id, requestedByName: me.name,
    }).returning();
    await logActivity("disposal", r.id, "created", `${number} proposed for ${a.tag}`, me.name, tx);
    await logActivity("asset", a.id, "disposal", `Disposal proposed (${number})`, me.name, tx);
    return r;
  });
  const res = await submit({ ...row, tag: a.tag }, me);
  revalidatePath("/assets/disposals");
  revalidatePath(`/assets/${a.id}`);
  revalidatePath("/approvals");
  if (!res.ok) return go(row.id, `${row.number} saved as a draft. ${res.error}`);
  return go(row.id, res.auto ? `${row.number}: no approval rule applies, so it was approved at once.` : `${row.number} submitted. The approvers have been notified.`);
}

async function load(fd: FormData, me: CurrentUser) {
  const did = Number(fd.get("disposalId"));
  const [d] = Number.isInteger(did) ? await db.select({ d: disposals, tag: assets.assetTag }).from(disposals).innerJoin(assets, eq(assets.id, disposals.assetId)).where(eq(disposals.id, did)) : [];
  if (!d) return null;
  await requireFacilityAccess(d.d.facilityId, me);
  return d;
}

export async function resubmitDisposalAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.dispose");
  const r = await load(fd, me);
  if (!r) return { error: "That request no longer exists." };
  if (r.d.status !== "DRAFT" && r.d.status !== "REJECTED") return { error: "Only a draft or rejected request can be submitted." };
  const res = await submit({ ...r.d, tag: r.tag }, me);
  if (!res.ok) return { error: res.error };
  revalidatePath(path(r.d.id));
  return go(r.d.id, res.auto ? "Approved at once: no approval rule applies." : "Submitted. The approvers have been notified.");
}

export async function withdrawDisposalAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.dispose");
  const r = await load(fd, me);
  if (!r) return { error: "That request no longer exists." };
  if (r.d.status !== "PENDING_APPROVAL") return { error: "Only a request waiting for approval can be withdrawn." };
  const ok = await cancelApproval("DISPOSAL", r.d.id, "withdrawn by biomedical engineering", me);
  if (!ok) await db.update(disposals).set({ status: "DRAFT" }).where(eq(disposals.id, r.d.id));
  revalidatePath(path(r.d.id));
  revalidatePath("/approvals");
  return go(r.d.id, "Withdrawn. It is a draft again.");
}

export async function cancelDisposalAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.dispose");
  const r = await load(fd, me);
  if (!r) return { error: "That request no longer exists." };
  if (r.d.status !== "DRAFT" && r.d.status !== "REJECTED") return { error: "Withdraw the request from approval first." };
  await db.update(disposals).set({ status: "CANCELLED" }).where(eq(disposals.id, r.d.id));
  await logActivity("disposal", r.d.id, "cancelled", `${r.d.number} cancelled; ${r.tag} stays in the register`, me.name);
  revalidatePath(path(r.d.id));
  revalidatePath("/assets/disposals");
  return go(r.d.id, "Request cancelled.");
}

const CompleteSchema = z.object({
  disposalId: reqId("Request"), disposedOn: isoDate("Disposal date"), method: oneOf("Disposal method", DISPOSAL_METHODS),
  proceeds: num("Proceeds", 0, 1e10), certificateRef: text(200), notes: text(2000),
});

/** After approval: record how and when the device left. The asset becomes DISPOSED. */
export async function completeDisposalAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.dispose");
  const r = await load(fd, me);
  if (!r) return { error: "That request no longer exists." };
  const p = CompleteSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  if (r.d.status !== "APPROVED") return { error: "The disposal must be approved before it is recorded." };
  if (!d.disposedOn) return { error: "Enter the date the device left the hospital." };
  if (d.disposedOn > todayISO()) return { error: "The disposal date can't be in the future." };
  if (!d.certificateRef) return { error: "Enter the reference of the disposal record (committee minutes, scrap certificate or receipt)." };
  const jobs = await db.select({ number: workOrders.number }).from(workOrders).where(and(eq(workOrders.assetId, r.d.assetId), inArray(workOrders.status, [...OPEN_JOB])));
  if (jobs.length) return { error: `Close or cancel the open work orders first: ${jobs.map((j) => j.number).join(", ")}.` };
  await db.transaction(async (tx) => {
    await tx.update(disposals).set({
      status: "COMPLETED", disposedOn: d.disposedOn!, method: d.method ?? r.d.method, proceeds: d.proceeds != null ? String(d.proceeds) : null,
      certificateRef: d.certificateRef!, notes: d.notes ?? null,
    }).where(eq(disposals.id, r.d.id));
    await tx.update(assets).set({ status: "DISPOSED", condition: "CONDEMNED" }).where(eq(assets.id, r.d.assetId));
    await tx.update(recallAssets).set({ status: "NOT_AFFECTED", note: `Disposed under ${r.d.number}`, actionedAt: new Date() })
      .where(and(eq(recallAssets.assetId, r.d.assetId), eq(recallAssets.status, "PENDING")));
    await logActivity("disposal", r.d.id, "completed", `Disposed on ${d.disposedOn} (${(d.method ?? r.d.method).toLowerCase().replace(/_/g, " ")}), ref. ${d.certificateRef}`, me.name, tx);
    await logActivity("asset", r.d.assetId, "status_changed", `Disposed under ${r.d.number}`, me.name, tx);
  });
  revalidatePath(path(r.d.id));
  revalidatePath(`/assets/${r.d.assetId}`);
  revalidatePath("/assets");
  return go(r.d.id, `${r.tag} is recorded as disposed.`);
}
