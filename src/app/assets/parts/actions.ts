"use server";
/** Spare part actions. Every export is a public endpoint: permission first, then facility, then validation. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { spareParts } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { dbError, firstError, formObject, id, int, num, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { applyMovement, notifyIfLow } from "@/lib/assets/parts-server";
import { bookJobPart, JobPartSchema } from "@/lib/assets/work-order-steps-server";
import { logActivity } from "@/lib/server-utils";

const partPath = (pid: number) => `/assets/parts/${pid}`;

const PartSchema = z.object({
  partNumber: reqText("Part number", 64), name: reqText("Name", 200), manufacturer: text(120), deviceTypeId: id(), supplierId: id(),
  unitCost: num("Unit cost", 0, 1e9), currency: text(3), minQty: int("Minimum stock", 0, 100000), location: text(120),
});

function values(d: z.infer<typeof PartSchema>) {
  return {
    partNumber: d.partNumber.toUpperCase(), name: d.name, manufacturer: d.manufacturer ?? null, deviceTypeId: d.deviceTypeId ?? null, supplierId: d.supplierId ?? null,
    unitCost: d.unitCost != null ? String(d.unitCost) : null, currency: d.unitCost != null ? (d.currency ?? "EGP").toUpperCase() : null,
    minQty: d.minQty ?? 0, location: d.location ?? null,
  };
}

export async function createPartAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("parts.edit");
  const p = PartSchema.extend({ facilityId: reqId("Hospital"), openingStock: int("Opening stock", 0, 100000) }).safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await requireFacilityAccess(p.data.facilityId, me);
  let partId: number;
  try {
    partId = await db.transaction(async (tx) => {
      const [row] = await tx.insert(spareParts).values({ ...values(p.data), facilityId: p.data.facilityId }).returning({ id: spareParts.id });
      if (p.data.openingStock) {
        const r = await applyMovement({ partId: row.id, kind: "RECEIPT", quantity: p.data.openingStock, note: "Opening stock", actor: me.name }, tx);
        if (!r.ok) throw new Error(r.error);
      }
      await logActivity("part", row.id, "created", `Part ${p.data.partNumber.toUpperCase()} added${p.data.openingStock ? ` with ${p.data.openingStock} in stock` : ""}`, me.name, tx);
      return row.id;
    });
  } catch (e) {
    return { error: dbError(e, "That part could not be saved.").replace("That code", "That part number") };
  }
  revalidatePath("/assets/parts");
  redirect(`${partPath(partId)}?notice=${encodeURIComponent("Part added.")}`);
}

export async function updatePartAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("parts.edit");
  const pid = Number(fd.get("partId"));
  const [part] = Number.isInteger(pid) ? await db.select().from(spareParts).where(eq(spareParts.id, pid)) : [];
  if (!part) return { error: "That part no longer exists." };
  await requireFacilityAccess(part.facilityId, me);
  const p = PartSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  try {
    await db.update(spareParts).set({ ...values(p.data), active: fd.get("active") === "on" }).where(eq(spareParts.id, part.id));
  } catch (e) {
    return { error: dbError(e, "That part could not be saved.").replace("That code", "That part number") };
  }
  await logActivity("part", part.id, "updated", "Part details updated", me.name);
  revalidatePath(partPath(part.id));
  redirect(`${partPath(part.id)}?notice=${encodeURIComponent("Part saved.")}`);
}

const StockSchema = z.object({ partId: reqId("Part"), kind: z.enum(["RECEIPT", "ADJUSTMENT"]), quantity: int("Quantity", -100000, 100000), note: text(300) });

/** Receive stock or correct a count (the store). Issues and returns happen on the work order. */
export async function moveStockAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("parts.edit");
  const p = StockSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const [part] = await db.select({ facilityId: spareParts.facilityId }).from(spareParts).where(eq(spareParts.id, p.data.partId));
  if (!part) return { error: "That part no longer exists." };
  await requireFacilityAccess(part.facilityId, me);
  if (p.data.kind === "ADJUSTMENT" && !p.data.note) return { error: "Say why the count is being corrected." };
  const r = await db.transaction(async (tx) => {
    const res = await applyMovement({ partId: p.data.partId, kind: p.data.kind, quantity: p.data.quantity ?? 0, note: p.data.note ?? null, actor: me.name }, tx);
    if (res.ok) await logActivity("part", p.data.partId, p.data.kind === "RECEIPT" ? "received" : "adjusted",
      `${p.data.kind === "RECEIPT" ? "Received" : "Count corrected by"} ${p.data.quantity}${p.data.note ? ` — ${p.data.note}` : ""} (stock ${res.after})`, me.name, tx);
    return res;
  });
  if (!r.ok) return { error: r.error };
  await notifyIfLow(r, p.data.partId);
  revalidatePath(partPath(p.data.partId));
  revalidatePath("/assets/parts");
  redirect(`${partPath(p.data.partId)}?notice=${encodeURIComponent(`Stock is now ${r.after}.`)}`);
}

/** Use parts on a job, or return unused ones. Only while the job is open; the part must be in the job's hospital. */
export async function jobPartsAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = JobPartSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const r = await bookJobPart(me, p.data);
  if ("error" in r) return { error: r.error };
  redirect(`/assets/work-orders/${p.data.workOrderId}?notice=${encodeURIComponent(p.data.step === "issue" ? `${r.quantity} × ${r.partName} booked to the job.` : "Part returned to stock.")}#parts`);
}
