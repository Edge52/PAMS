"use server";
/** Service contract actions. Each export is a public endpoint: permission, then facility, then validation. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes, serviceContractAssets, serviceContracts, suppliers } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { CONTRACT_TYPES } from "@/lib/assets/contracts";
import { firstError, formObject, id, int, isoDate, num, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { logActivity, nextNumber } from "@/lib/server-utils";

const path = (id: number) => `/assets/contracts/${id}`;
const go = (id: number, msg: string): never => redirect(`${path(id)}?notice=${encodeURIComponent(msg)}`);

const ContractSchema = z.object({
  facilityId: reqId("Hospital"), supplierId: reqId("Supplier"), title: reqText("Title", 200), type: oneOf("Contract type", CONTRACT_TYPES),
  vendorReference: text(120), startDate: isoDate("Start date"), endDate: isoDate("End date"),
  value: num("Contract value", 0, 1e11), currency: text(3), responseHours: int("Response time", 1, 2000), ppmVisitsPerYear: int("PPM visits", 0, 52),
  includesParts: z.preprocess((v) => v === "on" || v === "true", z.boolean()), contactName: text(120), contactPhone: text(48), notes: text(4000),
});

function values(d: z.infer<typeof ContractSchema>) {
  return {
    facilityId: d.facilityId, supplierId: d.supplierId, title: d.title, type: d.type ?? "FULL_SERVICE", vendorReference: d.vendorReference ?? null,
    startDate: d.startDate!, endDate: d.endDate!, value: d.value != null ? String(d.value) : null, currency: d.value != null ? (d.currency ?? "EGP").toUpperCase() : null,
    responseHours: d.responseHours ?? null, ppmVisitsPerYear: d.ppmVisitsPerYear ?? null, includesParts: d.includesParts,
    contactName: d.contactName ?? null, contactPhone: d.contactPhone ?? null, notes: d.notes ?? null,
  };
}

async function check(d: z.infer<typeof ContractSchema>): Promise<string | null> {
  if (!d.startDate || !d.endDate) return "Enter the start and end dates.";
  if (d.endDate < d.startDate) return "The end date is before the start date.";
  const [s] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, d.supplierId));
  return s ? null : "That supplier no longer exists.";
}

export async function createContractAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("contracts.edit");
  const p = ContractSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await requireFacilityAccess(p.data.facilityId, me);
  const problem = await check(p.data);
  if (problem) return { error: problem };
  const row = await db.transaction(async (tx) => {
    const number = await nextNumber("SC", serviceContracts, serviceContracts.number, tx);
    const [c] = await tx.insert(serviceContracts).values({ ...values(p.data), number }).returning({ id: serviceContracts.id, number: serviceContracts.number });
    await logActivity("contract", c.id, "created", `${c.number} created: ${p.data.title}`, me.name, tx);
    return c;
  });
  revalidatePath("/assets/contracts");
  return go(row.id, `${row.number} created. Now add the devices it covers.`);
}

export async function updateContractAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("contracts.edit");
  const contractId = Number(fd.get("contractId"));
  const [c] = Number.isInteger(contractId) ? await db.select().from(serviceContracts).where(eq(serviceContracts.id, contractId)) : [];
  if (!c) return { error: "That contract no longer exists." };
  await requireFacilityAccess(c.facilityId, me);
  const p = ContractSchema.safeParse({ ...formObject(fd), facilityId: String(c.facilityId) });
  if (!p.success) return { error: firstError(p.error) };
  const problem = await check(p.data);
  if (problem) return { error: problem };
  await db.update(serviceContracts).set(values(p.data)).where(eq(serviceContracts.id, c.id));
  await logActivity("contract", c.id, "updated", "Contract details updated", me.name);
  revalidatePath(path(c.id));
  revalidatePath("/assets/contracts");
  return go(c.id, "Contract saved.");
}

const AddSchema = z.object({ contractId: reqId("Contract"), tags: text(20000), deviceTypeId: id(), departmentId: id() });

/** Add devices by asset tags (one per line or comma separated) and/or every in-use device of a type (optionally in one department). */
export async function addContractAssetsAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("contracts.edit");
  const p = AddSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const [c] = await db.select().from(serviceContracts).where(eq(serviceContracts.id, p.data.contractId));
  if (!c) return { error: "That contract no longer exists." };
  await requireFacilityAccess(c.facilityId, me);
  const tags = [...new Set((p.data.tags ?? "").split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (!tags.length && !p.data.deviceTypeId) return { error: "Paste asset tags or choose a device type." };
  const found = new Map<number, string>();
  if (tags.length) {
    const rows = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).where(inArray(sql`upper(${assets.assetTag})`, tags));
    const missing = tags.filter((t) => !rows.some((r) => r.tag.toUpperCase() === t));
    const elsewhere = rows.filter((r) => r.facilityId !== c.facilityId);
    if (missing.length) return { error: `No device has the tag${missing.length > 1 ? "s" : ""} ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}.` };
    if (elsewhere.length) return { error: `${elsewhere.slice(0, 3).map((r) => r.tag).join(", ")} ${elsewhere.length > 1 ? "are" : "is"} in another hospital.` };
    for (const r of rows) found.set(r.id, r.tag);
  }
  if (p.data.deviceTypeId) {
    const rows = await db.select({ id: assets.id, tag: assets.assetTag }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(assets.facilityId, c.facilityId), eq(assets.deviceTypeId, p.data.deviceTypeId), sql`${assets.status} <> 'DISPOSED'`,
        p.data.departmentId ? eq(assets.departmentId, p.data.departmentId) : undefined)).limit(2001);
    if (rows.length > 2000) return { error: "That is more than 2,000 devices. Narrow it to one department." };
    if (!rows.length) return { error: "No in-use devices of that type in this hospital." };
    for (const r of rows) found.set(r.id, r.tag);
  }
  const added = await db.insert(serviceContractAssets).values([...found.keys()].map((assetId) => ({ contractId: c.id, assetId })))
    .onConflictDoNothing().returning({ assetId: serviceContractAssets.assetId });
  if (added.length) await logActivity("contract", c.id, "assets_added", `${added.length} device${added.length === 1 ? "" : "s"} added${added.length <= 5 ? `: ${added.map((a) => found.get(a.assetId)).join(", ")}` : ""}`, me.name);
  revalidatePath(path(c.id));
  return go(c.id, added.length ? `${added.length} device${added.length === 1 ? "" : "s"} added to the contract.` : "Those devices were already on the contract.");
}

export async function removeContractAssetAction(fd: FormData) {
  const me = await requirePermission("contracts.edit");
  const contractId = Number(fd.get("contractId")), assetId = Number(fd.get("assetId"));
  const [c] = Number.isInteger(contractId) ? await db.select().from(serviceContracts).where(eq(serviceContracts.id, contractId)) : [];
  if (!c || !Number.isInteger(assetId)) redirect("/assets/contracts");
  await requireFacilityAccess(c.facilityId, me);
  const [a] = await db.select({ tag: assets.assetTag }).from(assets).where(eq(assets.id, assetId));
  await db.delete(serviceContractAssets).where(and(eq(serviceContractAssets.contractId, c.id), eq(serviceContractAssets.assetId, assetId)));
  await logActivity("contract", c.id, "asset_removed", `${a?.tag ?? `Asset #${assetId}`} removed from the contract`, me.name);
  revalidatePath(path(c.id));
  go(c.id, `${a?.tag ?? "Device"} removed.`);
}
