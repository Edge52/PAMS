"use server";
/** Several contacts per supplier, by role (wave 12). */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { supplierContacts } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { logActivity } from "@/lib/server-utils";

const ROLES = ["SALES", "SERVICE", "FINANCE", "MANAGEMENT", "OTHER"] as const;
const str = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max) || null;

export async function addContactAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("suppliers.edit");
  const supplierId = Number(fd.get("supplierId")), role = String(fd.get("role")) as (typeof ROLES)[number];
  const name = str(fd, "name", 120), email = str(fd, "email", 255), phone = str(fd, "phone", 64);
  if (!name) return { error: "Enter the contact's name." };
  if (!ROLES.includes(role)) return { error: "Choose the contact's role." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Check the email address." };
  if (!email && !phone) return { error: "Give an email address or a phone number." };
  await db.insert(supplierContacts).values({ supplierId, name, role, jobTitle: str(fd, "jobTitle", 120), email, phone, notes: str(fd, "notes", 500) });
  await logActivity("supplier", supplierId, "contact", `${name} added (${role.toLowerCase()})`, me.name);
  revalidatePath(`/procurement/suppliers/${supplierId}`);
  return { ok: `${name} added.` };
}

export async function removeContactAction(fd: FormData) {
  const me = await requirePermission("suppliers.edit");
  const id = Number(fd.get("contactId")), supplierId = Number(fd.get("supplierId"));
  const r = await db.delete(supplierContacts).where(and(eq(supplierContacts.id, id), eq(supplierContacts.supplierId, supplierId))).returning({ name: supplierContacts.name });
  if (r.length) await logActivity("supplier", supplierId, "contact", `${r[0].name} removed`, me.name);
  revalidatePath(`/procurement/suppliers/${supplierId}`);
}
