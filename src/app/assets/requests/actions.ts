"use server";
/**
 * Equipment requests (wave 12, D9): a department asks for new or replacement equipment with a reason; the director
 * approves it for a year (it then shows in the capital plan) or rejects it; approved requests become a BOQ.
 */
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assets, boqDepartments, boqLines, boqs, departments, deviceTypes, equipmentRequests } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { replacementSetId } from "@/lib/boq/replacement-set";
import { defaultUnitPrices } from "@/lib/boq/generate";
import { notifyRole, notifyUsers } from "@/lib/notifications";
import { convert, logActivity, nextNumber } from "@/lib/server-utils";

const str = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);

export async function createRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.view");
  if (me.role !== "DEPARTMENT_HEAD" && !can(me.role, "assets.edit") && !can(me.role, "boq.edit")) return { error: "Department heads, biomedical engineering and planners can request equipment." };
  const facilityId = Number(fd.get("facilityId")), departmentId = Number(fd.get("departmentId")) || null, deviceTypeId = Number(fd.get("deviceTypeId"));
  await requireFacilityAccess(facilityId, me);
  const [t] = Number.isInteger(deviceTypeId) ? await db.select({ id: deviceTypes.id, name: deviceTypes.name, level: deviceTypes.level }).from(deviceTypes).where(eq(deviceTypes.id, deviceTypeId)) : [];
  if (!t || t.level !== 3) return { error: "Choose the kind of equipment." };
  const quantity = Number(fd.get("quantity") || 1), reason = str(fd, "reason", 2000);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return { error: "Quantity must be between 1 and 500." };
  if (reason.length < 10) return { error: "Say why it's needed (a sentence or two): the director decides on it." };
  const replacesTag = str(fd, "replaces", 48).toUpperCase();
  const [rep] = replacesTag ? await db.select({ id: assets.id }).from(assets).where(and(eq(assets.assetTag, replacesTag), eq(assets.facilityId, facilityId))) : [];
  if (replacesTag && !rep) return { error: `No device ${replacesTag} in this hospital.` };
  const priority = (["LOW", "NORMAL", "HIGH", "URGENT"] as const).find((p) => p === fd.get("priority")) ?? "NORMAL";
  const neededBy = str(fd, "neededBy", 10) || null;
  const number = await nextNumber("REQ", equipmentRequests, equipmentRequests.number);
  const [r] = await db.insert(equipmentRequests).values({ number, facilityId, departmentId, deviceTypeId: t.id, quantity, replacesAssetId: rep?.id ?? null, reason, priority, neededBy: neededBy && /^\d{4}-\d{2}-\d{2}$/.test(neededBy) ? neededBy : null, requestedById: me.id, requestedByName: me.name }).returning({ id: equipmentRequests.id });
  await logActivity("request", r.id, "submitted", `${number}: ${quantity} × ${t.name}`, me.name);
  await notifyRole("DIRECTOR", { kind: "equipment_request", title: `${number}: ${quantity} × ${t.name} requested`, body: reason.slice(0, 200), href: `/assets/requests?facilityId=${facilityId}`, dedupeKey: `req:${r.id}` }, facilityId);
  revalidatePath("/assets/requests"); revalidatePath("/assets/department");
  return { ok: `${number} sent to the director.` };
}

export async function decideRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.approve");
  const id = Number(fd.get("requestId")), decision = String(fd.get("decision")), note = str(fd, "note", 1000);
  const [r] = await db.select().from(equipmentRequests).where(eq(equipmentRequests.id, id));
  if (!r) return { error: "That request no longer exists." };
  await requireFacilityAccess(r.facilityId, me);
  if (r.status !== "SUBMITTED") return { error: "This request has already been decided." };
  const planYear = Number(fd.get("planYear")) || new Date().getFullYear();
  if (decision === "reject" && !note) return { error: "Give the reason, so the department knows." };
  await db.update(equipmentRequests).set({ status: decision === "reject" ? "REJECTED" : "APPROVED", decisionNote: note || null, decidedByName: me.name, decidedAt: new Date(), planYear: decision === "reject" ? null : planYear }).where(eq(equipmentRequests.id, id));
  await logActivity("request", id, decision === "reject" ? "rejected" : "approved", decision === "reject" ? note : `Approved for ${planYear}${note ? `: ${note}` : ""}`, me.name);
  if (r.requestedById) await notifyUsers([r.requestedById], { kind: "equipment_request", title: `${r.number} ${decision === "reject" ? "not approved" : `approved for ${planYear}`}`, body: note || undefined, href: `/assets/requests?facilityId=${r.facilityId}`, dedupeKey: `req:${id}:decided` });
  revalidatePath("/assets/requests");
  return { ok: decision === "reject" ? `${r.number} rejected.` : `${r.number} approved for ${planYear}: it now shows in the capital plan.` };
}

/** Approved requests → a draft BOQ (one line per department and type), marked as planned. */
export async function requestsToBoqAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.edit");
  const ids = [...new Set(fd.getAll("requestIds").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const name = str(fd, "name", 200);
  if (!ids.length) return { error: "Tick the approved requests to put in the BOQ." };
  if (name.length < 2) return { error: "Give the BOQ a name." };
  const rows = await db.select({ r: equipmentRequests, typeName: deviceTypes.name, dept: departments }).from(equipmentRequests).innerJoin(deviceTypes, eq(deviceTypes.id, equipmentRequests.deviceTypeId))
    .leftJoin(departments, eq(departments.id, equipmentRequests.departmentId)).where(and(inArray(equipmentRequests.id, ids), eq(equipmentRequests.status, "APPROVED")));
  if (!rows.length) return { error: "None of those requests is approved and waiting." };
  const facilities = [...new Set(rows.map((x) => x.r.facilityId))];
  if (facilities.length !== 1) return { error: "Choose requests from one hospital at a time." };
  await requireFacilityAccess(facilities[0], me);
  const prices = await defaultUnitPrices(db, rows.map((x) => x.r.deviceTypeId), "EGP", convert);
  const setId = await replacementSetId();
  const boqId = await db.transaction(async (tx) => {
    const [boq] = await tx.insert(boqs).values({ name, facilityId: facilities[0], standardSetId: setId, currency: "EGP", contingencyPct: 0, notes: `From equipment requests ${rows.map((x) => x.r.number).join(", ")}.` }).returning({ id: boqs.id });
    const byDept = new Map<number | null, typeof rows>();
    for (const x of rows) byDept.set(x.r.departmentId, [...(byDept.get(x.r.departmentId) ?? []), x]);
    for (const [, list] of byDept) {
      const d = list[0].dept;
      const [bd] = await tx.insert(boqDepartments).values({ boqId: boq.id, departmentTypeCode: d?.departmentTypeCode ?? "HOSP", departmentId: d?.id ?? null, label: d?.name ?? "Hospital-wide (no department)" }).returning({ id: boqDepartments.id });
      const byType = new Map<number, typeof rows>();
      for (const x of list) byType.set(x.r.deviceTypeId, [...(byType.get(x.r.deviceTypeId) ?? []), x]);
      for (const [typeId, items] of byType) {
        const qty = items.reduce((s, x) => s + x.r.quantity, 0);
        await tx.insert(boqLines).values({ boqId: boq.id, boqDepartmentId: bd.id, deviceTypeId: typeId, tier: items.some((x) => x.r.priority === "URGENT" || x.r.priority === "HIGH") ? "ESSENTIAL" : "RECOMMENDED",
          calculatedQty: qty, quantity: qty, isManual: true, unitPriceEstimate: prices.get(typeId)?.price ?? null,
          calcExplanation: `Requested: ${items.map((x) => `${x.r.number} (${x.r.quantity})`).join(", ")}`.slice(0, 1000), notes: items.map((x) => x.r.reason).join(" / ").slice(0, 1000) });
      }
    }
    await tx.update(equipmentRequests).set({ status: "PLANNED", boqId: boq.id }).where(inArray(equipmentRequests.id, rows.map((x) => x.r.id)));
    await logActivity("boq", boq.id, "created", `BOQ created from ${rows.length} equipment request${rows.length === 1 ? "" : "s"}`, me.name, tx);
    return boq.id;
  });
  revalidatePath("/assets/requests");
  redirect(`/boq/${boqId}?notice=${encodeURIComponent("BOQ created from the requests. Review prices and quantities, then submit it for approval.")}`);
}
