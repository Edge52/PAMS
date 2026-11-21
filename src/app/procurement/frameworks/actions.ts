"use server";
/**
 * Framework agreements (wave 10): agreed prices with a supplier up to a ceiling. A call-off raises a draft PO at the
 * agreed prices without a new tender, as long as it stays within the dates, the ceiling and each item's limit.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { departments, deviceTypes, frameworkItems, frameworks, poLines, purchaseOrders, suppliers } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { checkCallOff } from "@/lib/procurement/money";
import { calledOff } from "@/lib/procurement/money-server";
import { todayISO } from "@/lib/format";
import { logActivity, nextNumber } from "@/lib/server-utils";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);
const path = (id: number) => `/procurement/frameworks/${id}`;

export async function createFrameworkAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("procurement.edit");
  const title = str(fd, "title", 200), supplierId = Number(fd.get("supplierId")), facilityId = Number(fd.get("facilityId")) || null;
  const startDate = str(fd, "startDate", 10), endDate = str(fd, "endDate", 10), ceiling = Number(str(fd, "ceiling").replace(/,/g, ""));
  const currency = (str(fd, "currency", 3) || "EGP").toUpperCase();
  if (title.length < 2) return { error: "Give the agreement a title." };
  const [s] = Number.isInteger(supplierId) ? await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, supplierId)) : [];
  if (!s) return { error: "Choose the supplier." };
  if (facilityId) await requireFacilityAccess(facilityId, me);
  if (!DATE.test(startDate) || !DATE.test(endDate) || endDate < startDate) return { error: "Enter the start and end dates (end after start)." };
  if (!(ceiling > 0)) return { error: "Enter the agreement's ceiling." };
  const number = await nextNumber("FA", frameworks, frameworks.number);
  const [fw] = await db.insert(frameworks).values({ number, title, supplierId, facilityId, startDate, endDate, ceiling: ceiling.toFixed(2), currency, reference: str(fd, "reference", 200) || null, notes: str(fd, "notes", 2000) || null }).returning({ id: frameworks.id });
  await logActivity("framework", fw.id, "created", `${number}: ${title}`, me.name);
  redirect(`${path(fw.id)}?notice=${encodeURIComponent(`${number} created. Add its items and agreed prices.`)}`);
}

/** Wave 34 (S3): the agreement from the database, after checking the user may work on its hospital. */
async function frameworkFor(fd: FormData, me: Awaited<ReturnType<typeof requirePermission>>) {
  const id = Number(fd.get("frameworkId"));
  const [fw] = Number.isInteger(id) && id > 0 ? await db.select({ id: frameworks.id, facilityId: frameworks.facilityId }).from(frameworks).where(eq(frameworks.id, id)) : [];
  if (fw) await requireFacilityAccess(fw.facilityId, me);
  return fw ?? null;
}

export async function addFrameworkItemAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("procurement.edit");
  const fw = await frameworkFor(fd, me);
  if (!fw) return { error: "That agreement no longer exists." };
  const frameworkId = fw.id, deviceTypeId = Number(fd.get("deviceTypeId"));
  const unitPrice = Number(str(fd, "unitPrice").replace(/,/g, "")), maxQty = str(fd, "maxQty") ? Number(str(fd, "maxQty")) : null;
  const [t] = Number.isInteger(deviceTypeId) ? await db.select({ id: deviceTypes.id, name: deviceTypes.name, level: deviceTypes.level }).from(deviceTypes).where(eq(deviceTypes.id, deviceTypeId)) : [];
  if (!t || t.level !== 3) return { error: "Choose a device type." };
  if (!(unitPrice >= 0)) return { error: "Enter the agreed unit price." };
  if (maxQty != null && !(Number.isInteger(maxQty) && maxQty > 0)) return { error: "The quantity limit must be a whole number." };
  await db.insert(frameworkItems).values({ frameworkId, deviceTypeId: t.id, description: str(fd, "description", 300) || t.name, manufacturer: str(fd, "manufacturer", 120) || null, model: str(fd, "model", 120) || null, unitPrice: unitPrice.toFixed(2), maxQty });
  revalidatePath(path(frameworkId));
  return { ok: `${str(fd, "description", 300) || t.name} added.` };
}

export async function removeFrameworkItemAction(fd: FormData) {
  const me = await requirePermission("procurement.edit");
  const fw = await frameworkFor(fd, me);
  if (!fw) return;
  // Wave 34 (S3): the item must belong to this agreement, and "called off" is worked out from the item's own
  // agreement and device type in the database, not from ids sent by the browser.
  const itemId = Number(fd.get("itemId"));
  const [item] = Number.isInteger(itemId) && itemId > 0 ? await db.select({ id: frameworkItems.id, deviceTypeId: frameworkItems.deviceTypeId, description: frameworkItems.description }).from(frameworkItems)
    .where(and(eq(frameworkItems.id, itemId), eq(frameworkItems.frameworkId, fw.id))) : [];
  if (!item) return;
  const used = await db.select({ id: poLines.id }).from(poLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(and(eq(purchaseOrders.frameworkId, fw.id), eq(poLines.deviceTypeId, item.deviceTypeId))).limit(1);
  if (!used.length) {
    await db.delete(frameworkItems).where(and(eq(frameworkItems.id, item.id), eq(frameworkItems.frameworkId, fw.id)));
    await logActivity("framework", fw.id, "item removed", `${item.description} removed`, me.name);
  }
  revalidatePath(path(fw.id));
}

export async function createCallOffAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("po.create");
  const frameworkId = Number(fd.get("frameworkId"));
  const [fw] = await db.select().from(frameworks).where(eq(frameworks.id, frameworkId));
  if (!fw) return { error: "That agreement no longer exists." };
  const facilityId = fw.facilityId ?? (Number(fd.get("facilityId")) || null);
  if (!facilityId) return { error: "Choose the hospital the call-off is for." };
  await requireFacilityAccess(facilityId, me);
  const items = await db.select().from(frameworkItems).where(eq(frameworkItems.frameworkId, fw.id));
  const done = await calledOff(fw.id);
  const chosen = items.map((i) => ({ i, qty: Number(fd.get(`qty_${i.id}`) || 0) })).filter((x) => Number.isInteger(x.qty) && x.qty > 0);
  const check = checkCallOff({ startDate: fw.startDate, endDate: fw.endDate, ceiling: Number(fw.ceiling), calledOff: done.value },
    chosen.map(({ i, qty }) => ({ description: i.description, qty, unitPrice: Number(i.unitPrice), maxQty: i.maxQty, usedQty: done.qty.find((q) => q.desc === i.description && q.dt === i.deviceTypeId)?.q ?? 0 })), todayISO());
  if (!check.ok) return { error: check.problems.join(" ") };
  const dept = Number(fd.get("departmentId")) || null;
  const [d] = dept ? await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, dept), eq(departments.facilityId, facilityId))) : [];
  const number = await nextNumber("PO", purchaseOrders, purchaseOrders.number);
  const poId = await db.transaction(async (tx) => {
    const [po] = await tx.insert(purchaseOrders).values({ number, supplierId: fw.supplierId, facilityId, frameworkId: fw.id, status: "DRAFT", currency: fw.currency,
      notes: `Call-off under framework agreement ${fw.number}${fw.reference ? ` (${fw.reference})` : ""}.` }).returning({ id: purchaseOrders.id });
    await tx.insert(poLines).values(chosen.map(({ i, qty }) => ({ poId: po.id, deviceTypeId: i.deviceTypeId, description: i.description, manufacturer: i.manufacturer, model: i.model, quantity: qty, unitPrice: i.unitPrice, destinationDepartmentId: d?.id ?? null })));
    return po.id;
  });
  await logActivity("framework", fw.id, "call-off", `${number} drafted`, me.name);
  await logActivity("po", poId, "created", `${number} drafted as a call-off under ${fw.number}`, me.name);
  redirect(`/procurement/purchase-orders/${poId}?created=1`);
}
