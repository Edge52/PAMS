"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { logActivity } from "@/lib/server-utils";
import { fail, formObject, optNum, optStr, reqStr, zodErrors, type ActionState } from "@/lib/procurement/forms";
import { SUPPLIER_TYPES } from "@/lib/procurement/labels";

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
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const existing = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, parsed.data.name));
  if (existing.length) return fail(`A supplier called ${parsed.data.name} already exists.`);
  const [row] = await db.insert(suppliers).values(values(parsed.data)).returning({ id: suppliers.id });
  await logActivity("supplier", row.id, "created", `Supplier ${parsed.data.name} added`);
  revalidatePath("/procurement/suppliers");
  redirect(`/procurement/suppliers/${row.id}`);
}

export async function updateSupplier(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("suppliers.edit");
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const [before] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!before) return fail("This supplier no longer exists.");
  await db.update(suppliers).set(values(parsed.data)).where(eq(suppliers.id, id));
  await logActivity("supplier", id, "updated", `Supplier details updated${before.rating !== (parsed.data.rating ?? null) ? `, rating ${parsed.data.rating ?? "cleared"}` : ""}`);
  revalidatePath(`/procurement/suppliers/${id}`);
  redirect(`/procurement/suppliers/${id}`);
}

export async function toggleSupplierActive(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("suppliers.edit");
  const id = Number(fd.get("supplierId"));
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) return fail("This supplier no longer exists.");
  await db.update(suppliers).set({ active: !s.active }).where(eq(suppliers.id, id));
  await logActivity("supplier", id, "status_changed", s.active ? "Supplier deactivated (hidden from new RFQs)" : "Supplier reactivated");
  revalidatePath(`/procurement/suppliers/${id}`);
  revalidatePath("/procurement/suppliers");
  return { message: s.active ? "Supplier deactivated." : "Supplier reactivated." };
}
