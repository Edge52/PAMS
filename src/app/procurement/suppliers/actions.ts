"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { logActivity } from "@/lib/server-utils";
import { changeSummary, diff } from "@/lib/audit-diff";
import { fail, formObject, optNum, optStr, reqStr, type ActionState, zodFail } from "@/lib/procurement/forms";
import { SUPPLIER_TYPES } from "@/lib/procurement/labels";
import { cleanLegalName } from "@/lib/procurement/legal-names";
import { setSupplierLegalName, supplierLegalName } from "@/lib/procurement/legal-names-server";

/** Wave 38: the Arabic legal name field, checked apart from the main schema. */
function legalNameField(fd: FormData) {
  const r = cleanLegalName(fd.get("nameAr"));
  return r.ok ? { value: r.value } : { error: { errors: [r.error], fields: { nameAr: r.error } } as ActionState };
}

const schema = z.object({
  name: reqStr("Enter the supplier's name", 200),
  type: z.enum(SUPPLIER_TYPES, { error: "Choose the supplier type" }),
  country: optStr(80),
  brands: optStr(1000),
  contactName: optStr(200),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.email("Enter a valid email address").max(255).optional()),
  phone: optStr(64),
  address: optStr(500),
  taxId: optStr(64),
  commercialRegister: optStr(64),
  rating: optNum("Rating must be between 0 and 5", 0, 5),
  notes: optStr(4000),
});

function values(d: z.infer<typeof schema>) {
  const brands = d.brands ? [...new Set(d.brands.split(/[,;\n]+/).map((b) => b.trim()).filter(Boolean))] : [];
  return {
    name: d.name, type: d.type, country: d.country ?? null, brands, contactName: d.contactName ?? null, email: d.email ?? null,
    phone: d.phone ?? null, address: d.address ?? null, taxId: d.taxId ?? null, commercialRegister: d.commercialRegister ?? null,
    rating: d.rating ?? null, notes: d.notes ?? null,
  };
}

export async function createSupplier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("suppliers.edit");
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const ar = legalNameField(fd);
  if ("error" in ar) return ar.error!;
  const existing = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, parsed.data.name));
  if (existing.length) return fail(`A supplier called ${parsed.data.name} already exists.`);
  const [row] = await db.insert(suppliers).values(values(parsed.data)).returning({ id: suppliers.id });
  if (ar.value) await setSupplierLegalName(row.id, ar.value);
  await logActivity("supplier", row.id, "created", `Supplier ${parsed.data.name} added`);
  revalidatePath("/procurement/suppliers");
  redirect(`/procurement/suppliers/${row.id}`);
}

export async function updateSupplier(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("suppliers.edit");
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const ar = legalNameField(fd);
  if ("error" in ar) return ar.error!;
  const [before] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!before) return fail("This supplier no longer exists.");
  const next = values(parsed.data);
  const arBefore = await supplierLegalName(id);
  const changes = diff({ ...before, nameAr: arBefore }, { ...next, nameAr: ar.value });
  await db.update(suppliers).set(next).where(eq(suppliers.id, id));
  if (arBefore !== ar.value) await setSupplierLegalName(id, ar.value);
  if (changes) await logActivity("supplier", id, "updated", `Supplier details updated. ${changeSummary(changes)}`, undefined, db, changes);
  revalidatePath(`/procurement/suppliers/${id}`);
  redirect(`/procurement/suppliers/${id}`);
}

export async function toggleSupplierActive(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("suppliers.edit");
  const id = Number(fd.get("supplierId"));
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) return fail("This supplier no longer exists.");
  await db.update(suppliers).set({ active: !s.active }).where(eq(suppliers.id, id));
  await logActivity("supplier", id, "status_changed", s.active ? "Supplier deactivated (hidden from new RFQs)" : "Supplier reactivated", undefined, db, diff(s, { active: !s.active }));
  revalidatePath(`/procurement/suppliers/${id}`);
  revalidatePath("/procurement/suppliers");
  return { message: s.active ? "Supplier deactivated." : "Supplier reactivated." };
}
