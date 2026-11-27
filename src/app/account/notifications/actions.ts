"use server";
/**
 * Wave 41: your own notification choices and daily digest, and approval deputies (out of office). Administrators
 * (users.manage) set a deputy for anyone and end anyone's.
 */
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { approvalDelegations, notificationDigests, notificationPrefs, users } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { delegationProblem } from "@/lib/approvals/escalation";
import { isChannel, isSafetyKind, SETTABLE_KINDS } from "@/lib/notifications/prefs";
import { fail, formObject, idParam, optStr, type ActionState, zodFail } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

function refresh() {
  revalidatePath("/account/notifications");
  revalidatePath("/admin/notifications");
  revalidatePath("/approvals");
}

export async function saveMyNotificationPrefs(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  const hour = Number(fd.get("digestHour"));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return fail("Choose the hour for the daily digest.");
  const digest = fd.get("digest") === "on";
  const choices: { kind: string; channel: string }[] = [];
  for (const kind of SETTABLE_KINDS) {
    const v = String(fd.get(`ch_${kind}`) ?? "");
    if (!v) continue; // the role default
    if (!isChannel(v)) return fail("Choose in app, email, both or off.");
    // Safety-critical kinds keep the inbox: "off" is stored as "in app", "email" as "both".
    choices.push({ kind, channel: isSafetyKind(kind) ? (v === "OFF" ? "APP" : v === "EMAIL" ? "BOTH" : v) : v });
  }
  await db.transaction(async (tx) => {
    await tx.delete(notificationPrefs).where(eq(notificationPrefs.userId, me.id));
    if (choices.length) await tx.insert(notificationPrefs).values(choices.map((c) => ({ userId: me.id, ...c })));
    await tx.insert(notificationDigests).values({ userId: me.id, enabled: digest, hour })
      .onConflictDoUpdate({ target: notificationDigests.userId, set: { enabled: digest, hour } });
  });
  refresh();
  return { message: digest ? `Saved. Emails come as one daily digest at ${String(hour).padStart(2, "0")}:00.` : "Saved." };
}

const DeputySchema = z.object({
  userId: z.preprocess((v) => (v === "" || v == null ? undefined : v), idParam("Person").optional()),
  deputyId: idParam("Choose the deputy"),
  startsOn: z.string({ error: "Enter the first day" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the first day"),
  endsOn: z.string({ error: "Enter the last day" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the last day"),
  reason: optStr(300),
});

/** Name a deputy for a date range. `userId` other than yourself needs users.manage. */
export async function setDeputyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  const p = DeputySchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const userId = p.data.userId ?? me.id;
  if (userId !== me.id && !can(me.role, "users.manage")) return fail("Only an administrator can name a deputy for someone else.");
  const [person] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId));
  const [deputy] = await db.select({ id: users.id, name: users.name, active: users.active }).from(users).where(eq(users.id, p.data.deputyId));
  if (!person) return fail("That person no longer exists.");
  if (!deputy?.active) return fail("Choose an active user as the deputy.");
  const today = todayISO();
  const existing = (await db.select().from(approvalDelegations)
    .where(and(isNull(approvalDelegations.cancelledAt), inArray(approvalDelegations.userId, [userId, deputy.id]))).limit(200))
    .map((d) => ({ id: d.id, userId: d.userId, deputyId: d.deputyId, startsOn: d.startsOn, endsOn: d.endsOn }));
  const d = { userId, deputyId: deputy.id, startsOn: p.data.startsOn, endsOn: p.data.endsOn };
  const problem = delegationProblem(d, existing, today);
  if (problem) return fail(problem);
  await db.insert(approvalDelegations).values({ ...d, reason: p.data.reason ?? null, setById: me.id, setByName: me.name });
  await logActivity("user", userId, "deputy_set", `${deputy.name} decides ${person.name}'s approvals from ${d.startsOn} to ${d.endsOn}${userId !== me.id ? ` (set by ${me.name})` : ""}`, me.name);
  refresh();
  return { message: `${deputy.name} will receive ${userId === me.id ? "your" : `${person.name}'s`} approvals from ${d.startsOn} to ${d.endsOn}.` };
}

/** End a delegation early (your own, or anyone's for an administrator). */
export async function endDeputyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  const p = z.object({ delegationId: idParam("Delegation missing") }).safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const [d] = await db.select().from(approvalDelegations).where(eq(approvalDelegations.id, p.data.delegationId));
  if (!d || d.cancelledAt) return fail("This deputy has already ended.");
  if (d.userId !== me.id && !can(me.role, "users.manage")) return fail("Only an administrator can end someone else's deputy.");
  await db.update(approvalDelegations).set({ cancelledAt: new Date() }).where(eq(approvalDelegations.id, d.id));
  await logActivity("user", d.userId, "deputy_ended", `Deputy for approvals ended (${d.startsOn} to ${d.endsOn})`, me.name);
  refresh();
  return { message: "Deputy ended. Approvals come back to the person from now on." };
}
