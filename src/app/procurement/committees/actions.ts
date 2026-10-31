"use server";
/** Tender committees (Law 182/2018 art. 28–29): formation decision, members and their capacity. */
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { approvalRequests, committeeMembers, committees, offers, projects, userFacilities, users } from "@/db/schema";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import { CAPACITIES, CAPACITY_LABELS, COMMITTEE_KINDS, KIND_LABELS, votesByDefault, type Capacity, type CommitteeKind } from "@/lib/procurement/committees";
import { fail, formObject, idParam, isUniqueViolation, optDate, optStr, zodErrors, type ActionState } from "@/lib/procurement/forms";

const back = (projectId: number) => revalidatePath(`/procurement/${projectId}`);

async function projectFor(projectId: number, me: CurrentUser) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (p) await requireFacilityAccess(p.facilityId, me);
  return p ?? null;
}

/** Members sign award recommendations: the committee can't change while one is waiting for signatures. */
async function awardInProgress(projectId: number): Promise<boolean> {
  const ids = (await db.select({ id: offers.id }).from(offers).where(eq(offers.projectId, projectId))).map((o) => o.id);
  if (!ids.length) return false;
  const [r] = await db.select({ id: approvalRequests.id }).from(approvalRequests)
    .where(and(eq(approvalRequests.entity, "AWARD"), eq(approvalRequests.status, "PENDING"), inArray(approvalRequests.entityId, ids))).limit(1);
  return !!r;
}
const LOCKED = "An award recommendation from this tender is waiting for signatures. Withdraw it before changing the committee.";

async function committeeFor(committeeId: number, me: CurrentUser) {
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) return null;
  const p = await projectFor(c.projectId, me);
  return p ? { c, p } : null;
}

const committeeSchema = z.object({
  kind: z.enum(COMMITTEE_KINDS as [CommitteeKind, ...CommitteeKind[]], { error: "Choose the type of committee" }),
  decisionRef: optStr(200),
  formedOn: optDate("Enter the formation date as a date"),
  dueBy: optDate("Enter the due date as a date"),
  notes: optStr(2000),
});

export async function createCommittee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = committeeSchema.extend({ projectId: idParam("Project missing") }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const d = parsed.data;
  const p = await projectFor(d.projectId, me);
  if (!p) return fail("This project no longer exists.");
  if (d.formedOn && d.dueBy && d.dueBy < d.formedOn) return fail("The due date must be after the formation date.");
  const existing = (await db.select({ kind: committees.kind }).from(committees).where(eq(committees.projectId, p.id))).map((c) => c.kind);
  if (d.kind === "COMBINED" && existing.some((k) => k !== "COMBINED")) return fail("This tender already has separate committees; a combined committee replaces both. Delete them first.");
  if (d.kind !== "COMBINED" && existing.includes("COMBINED")) return fail("This tender has a combined committee. Delete it first to form separate opening and adjudication committees.");
  try {
    const [c] = await db.insert(committees).values({
      projectId: p.id, kind: d.kind, decisionRef: d.decisionRef ?? null, formedOn: d.formedOn ?? null, dueBy: d.dueBy ?? null, notes: d.notes ?? null,
    }).returning({ id: committees.id });
    await logActivity("project", p.id, "committee_formed", `${KIND_LABELS[d.kind]} formed${d.decisionRef ? ` (decision ${d.decisionRef})` : ""}`, me.name);
    back(p.id);
    return { message: `${KIND_LABELS[d.kind]} created (#${c.id}). Now add its members.` };
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`This tender already has a ${KIND_LABELS[d.kind].toLowerCase()}.`);
    throw e;
  }
}

export async function updateCommittee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = committeeSchema.omit({ kind: true }).extend({ committeeId: idParam("Committee missing") }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const d = parsed.data;
  const found = await committeeFor(d.committeeId, me);
  if (!found) return fail("This committee no longer exists.");
  if (d.formedOn && d.dueBy && d.dueBy < d.formedOn) return fail("The due date must be after the formation date.");
  await db.update(committees).set({ decisionRef: d.decisionRef ?? null, formedOn: d.formedOn ?? null, dueBy: d.dueBy ?? null, notes: d.notes ?? null })
    .where(eq(committees.id, d.committeeId));
  await logActivity("project", found.p.id, "committee_updated", `${KIND_LABELS[found.c.kind as CommitteeKind]}: formation details updated`, me.name);
  back(found.p.id);
  return { message: "Saved." };
}

export async function deleteCommittee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const found = await committeeFor(Number(fd.get("committeeId")), me);
  if (!found) return fail("This committee no longer exists.");
  if (await awardInProgress(found.p.id)) return fail(LOCKED);
  await db.delete(committees).where(eq(committees.id, found.c.id));
  await logActivity("project", found.p.id, "committee_deleted", `${KIND_LABELS[found.c.kind as CommitteeKind]} deleted`, me.name);
  back(found.p.id);
  return { message: "Committee deleted." };
}

export async function addCommitteeMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const parsed = z.object({
    committeeId: idParam("Committee missing"),
    userId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
    name: optStr(200),
    capacity: z.enum(CAPACITIES as [Capacity, ...Capacity[]], { error: "Choose the member's capacity" }),
  }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const d = parsed.data;
  const found = await committeeFor(d.committeeId, me);
  if (!found) return fail("This committee no longer exists.");
  if (await awardInProgress(found.p.id)) return fail(LOCKED);
  let name = d.name ?? null;
  if (d.userId) {
    const [u] = await db.select({ name: users.name, active: users.active, role: users.role, allFacilities: users.allFacilities }).from(users).where(eq(users.id, d.userId));
    if (!u || !u.active) return fail("Choose an active user, or type the name of an external member.");
    // A member who can't see this tender's facility could never sign the recommendation.
    if (found.p.facilityId != null && u.role !== "ADMIN" && !u.allFacilities) {
      const [ok] = await db.select({ u: userFacilities.userId }).from(userFacilities)
        .where(and(eq(userFacilities.userId, d.userId), eq(userFacilities.facilityId, found.p.facilityId)));
      if (!ok) return fail(`${u.name} doesn't have access to this tender's facility, so they couldn't sign. Give them access under Users first.`);
    }
    const [dup] = await db.select({ id: committeeMembers.id }).from(committeeMembers)
      .where(and(eq(committeeMembers.committeeId, d.committeeId), eq(committeeMembers.userId, d.userId)));
    if (dup) return fail(`${u.name} is already on this committee.`);
    name = u.name;
  }
  if (!name) return fail("Choose a user, or type the name of an external member (e.g. the Ministry of Finance representative).");
  if (d.capacity === "CHAIR") {
    const [chair] = await db.select({ name: committeeMembers.name }).from(committeeMembers)
      .where(and(eq(committeeMembers.committeeId, d.committeeId), eq(committeeMembers.capacity, "CHAIR")));
    if (chair) return fail(`${chair.name} already chairs this committee. Remove them first to name another chair.`);
  }
  await db.insert(committeeMembers).values({ committeeId: d.committeeId, userId: d.userId ?? null, name, capacity: d.capacity, votes: votesByDefault(d.capacity) });
  await logActivity("project", found.p.id, "committee_member_added", `${KIND_LABELS[found.c.kind as CommitteeKind]}: ${name} added as ${CAPACITY_LABELS[d.capacity].toLowerCase()}${d.userId ? "" : " (external, signs on paper)"}`, me.name);
  back(found.p.id);
  return { message: `${name} added.` };
}

export async function removeCommitteeMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("procurement.edit");
  const memberId = Number(fd.get("memberId"));
  const [m] = await db.select().from(committeeMembers).where(eq(committeeMembers.id, memberId));
  if (!m) return fail("This member was already removed.");
  const found = await committeeFor(m.committeeId, me);
  if (!found) return fail("This committee no longer exists.");
  if (await awardInProgress(found.p.id)) return fail(LOCKED);
  await db.delete(committeeMembers).where(eq(committeeMembers.id, memberId));
  await logActivity("project", found.p.id, "committee_member_removed", `${KIND_LABELS[found.c.kind as CommitteeKind]}: ${m.name} removed`, me.name);
  back(found.p.id);
  return { message: `${m.name} removed.` };
}
