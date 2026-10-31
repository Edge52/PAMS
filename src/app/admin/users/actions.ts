"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { userFacilities, users } from "@/db/schema";
import { ROLES } from "@/lib/auth/permissions";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { destroyAllSessions, requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import type { ActionState } from "@/lib/procurement/forms";

const base = z.object({
  name: z.string().trim().min(2, "Enter the person's name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(ROLES, { message: "Choose a role." }),
  jobTitle: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  allFacilities: z.string().optional(),
});

function facilityIds(fd: FormData) {
  return [...new Set(fd.getAll("facilityIds").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

async function emailTaken(email: string, exceptId?: number) {
  const [r] = await db.select({ id: users.id }).from(users)
    .where(exceptId ? and(sql`lower(${users.email}) = ${email}`, ne(users.id, exceptId)) : sql`lower(${users.email}) = ${email}`);
  return !!r;
}

async function otherActiveAdmins(exceptId: number) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.active, true), ne(users.id, exceptId)));
  return r?.n ?? 0;
}

export async function createUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("users.manage");
  const p = base.safeParse(Object.fromEntries(fd));
  if (!p.success) return { errors: [...new Set(p.error.issues.map((i) => i.message))] };
  const d = p.data;
  const password = String(fd.get("password") ?? "");
  const problem = passwordProblem(password, d.email);
  if (problem) return { errors: [`Temporary password: ${problem}`] };
  if (await emailTaken(d.email)) return { errors: ["Someone already uses that email address."] };
  const all = d.allFacilities === "on" || d.role === "ADMIN";
  const fac = facilityIds(fd);
  if (!all && fac.length === 0) return { errors: ["Choose at least one facility, or tick “All facilities”."] };
  const id = await db.transaction(async (tx) => {
    const [{ id }] = await tx.insert(users).values({
      name: d.name, email: d.email, role: d.role, jobTitle: d.jobTitle || null, phone: d.phone || null,
      allFacilities: all, passwordHash: await hashPassword(password),
    }).returning({ id: users.id });
    if (!all) await tx.insert(userFacilities).values(fac.map((facilityId) => ({ userId: id, facilityId })));
    return id;
  });
  await logActivity("user", id, "created", `User ${d.name} added as ${d.role}`);
  revalidatePath("/admin/users");
  redirect(`/admin/users/${id}?created=1`);
}

export async function updateUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("users.manage");
  const id = Number(fd.get("id"));
  const p = base.safeParse(Object.fromEntries(fd));
  if (!p.success) return { errors: [...new Set(p.error.issues.map((i) => i.message))] };
  const d = p.data;
  const active = fd.get("active") === "on";
  const [cur] = await db.select().from(users).where(eq(users.id, id));
  if (!cur) return { errors: ["That user no longer exists."] };
  if (await emailTaken(d.email, id)) return { errors: ["Someone already uses that email address."] };
  if (cur.role === "ADMIN" && (d.role !== "ADMIN" || !active) && (await otherActiveAdmins(id)) === 0)
    return { errors: ["This is the only active administrator. Make someone else an administrator first."] };
  if (id === me.id && !active) return { errors: ["You can't switch off your own account."] };
  const all = d.allFacilities === "on" || d.role === "ADMIN";
  const fac = facilityIds(fd);
  if (!all && fac.length === 0) return { errors: ["Choose at least one facility, or tick “All facilities”."] };
  await db.transaction(async (tx) => {
    await tx.update(users).set({ name: d.name, email: d.email, role: d.role, jobTitle: d.jobTitle || null, phone: d.phone || null, allFacilities: all, active })
      .where(eq(users.id, id));
    await tx.delete(userFacilities).where(eq(userFacilities.userId, id));
    if (!all) await tx.insert(userFacilities).values(fac.map((facilityId) => ({ userId: id, facilityId })));
  });
  if (!active) await destroyAllSessions(id);
  const changes = [cur.role !== d.role && `role ${cur.role} → ${d.role}`, cur.active !== active && (active ? "switched on" : "switched off")].filter(Boolean);
  await logActivity("user", id, "updated", `User details updated${changes.length ? ` (${changes.join(", ")})` : ""}`);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${id}`);
  return { message: "Saved." };
}

export async function resetPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("users.manage");
  const id = Number(fd.get("id"));
  const password = String(fd.get("password") ?? "");
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) return { errors: ["That user no longer exists."] };
  const problem = passwordProblem(password, u.email);
  if (problem) return { errors: [problem] };
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
  await destroyAllSessions(id);
  await logActivity("user", id, "password_reset", "Password reset by an administrator");
  return { message: "Password reset. Give it to them in person; they're signed out everywhere and can change it under Your account." };
}
