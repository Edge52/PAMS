"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { logActivity } from "@/lib/server-utils";
import { formatMoney } from "@/lib/format";
import {
  currency, fail, formObject, idParam, isUniqueViolation, optDate, optNum, optStr, reqStr, zodErrors, type ActionState,
} from "@/lib/procurement/forms";
import { humanizeEnum, PROJECT_STATUSES } from "@/lib/procurement/labels";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";

const projectSchema = z.object({
  code: reqStr("Enter the tender or project code", 48),
  title: reqStr("Enter a project title", 300),
  client: optStr(120),
  facilityId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
  status: z.enum(PROJECT_STATUSES, { error: "Choose a status" }).default("PLANNING"),
  currency,
  budget: optNum("Enter the budget as a positive number up to 999,999,999,999"),
  submissionDeadline: optDate("Enter the submission deadline as a date"),
  notes: optStr(4000),
});

function values(d: z.infer<typeof projectSchema>) {
  return {
    code: d.code, title: d.title, client: d.client ?? null, facilityId: d.facilityId ?? null, status: d.status,
    currency: d.currency, budget: d.budget != null ? String(d.budget) : null,
    submissionDeadline: d.submissionDeadline ?? null, notes: d.notes ?? null,
  };
}

export async function createProject(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = projectSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  await requireFacilityAccess(parsed.data.facilityId, me);
  let id: number;
  try {
    const [row] = await db.insert(projects).values(values(parsed.data)).returning({ id: projects.id });
    id = row.id;
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`A project with code ${parsed.data.code} already exists. Use a different code.`);
    console.error(e);
    return fail("The project could not be saved. Please try again.");
  }
  await logActivity("project", id, "created", `Project ${parsed.data.code} created`);
  revalidatePath("/procurement");
  redirect(`/procurement/${id}`);
}

export async function updateProject(projectId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = projectSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const [before] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!before) return fail("This project no longer exists.");
  await requireFacilityAccess(before.facilityId, me);
  await requireFacilityAccess(parsed.data.facilityId, me);
  try {
    await db.update(projects).set(values(parsed.data)).where(eq(projects.id, projectId));
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`A project with code ${parsed.data.code} already exists. Use a different code.`);
    console.error(e);
    return fail("The project could not be saved. Please try again.");
  }
  const changes: string[] = [];
  if (before.status !== parsed.data.status) changes.push(`status ${humanizeEnum(before.status).toLowerCase()} → ${humanizeEnum(parsed.data.status).toLowerCase()}`);
  if ((before.budget ?? null) !== (parsed.data.budget != null ? Number(parsed.data.budget).toFixed(2) : null))
    changes.push(`budget ${formatMoney(parsed.data.budget ?? null, parsed.data.currency)}`);
  if ((before.submissionDeadline ?? null) !== (parsed.data.submissionDeadline ?? null)) changes.push(`deadline ${parsed.data.submissionDeadline ?? "cleared"}`);
  await logActivity("project", projectId, "updated", `Project details updated${changes.length ? `: ${changes.join(", ")}` : ""}`);
  revalidatePath(`/procurement/${projectId}`);
  redirect(`/procurement/${projectId}`);
}

export async function setProjectStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = z.object({ projectId: idParam("Project missing"), status: z.enum(PROJECT_STATUSES, { error: "Choose a status" }) })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const { projectId, status } = parsed.data;
  const [p] = await db.select({ status: projects.status, facilityId: projects.facilityId }).from(projects).where(eq(projects.id, projectId));
  if (!p) return fail("This project no longer exists.");
  await requireFacilityAccess(p.facilityId, me);
  if (p.status === status) return { message: "Status unchanged." };
  await db.update(projects).set({ status }).where(eq(projects.id, projectId));
  await logActivity("project", projectId, "status_changed", `Status changed from ${humanizeEnum(p.status).toLowerCase()} to ${humanizeEnum(status).toLowerCase()}`);
  revalidatePath(`/procurement/${projectId}`);
  revalidatePath("/procurement");
  return { message: `Status set to ${humanizeEnum(status).toLowerCase()}.` };
}
