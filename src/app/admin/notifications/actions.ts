"use server";
/** Wave 41: notification defaults per role, approval escalation days and fault-report targets (settings.manage). */
import { revalidatePath } from "next/cache";
import { ROLES } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { ESCALATION_ENTITIES } from "@/lib/approvals/escalation";
import { FAULT_CLASSES } from "@/lib/assets/fault-escalation";
import { isChannel, isSafetyKind, SETTABLE_KINDS } from "@/lib/notifications/prefs";
import { fail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";
import { getSetting, setSetting } from "@/lib/settings";

export async function saveRoleDefaultsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("settings.manage");
  const role = String(fd.get("role") ?? "");
  if (!(ROLES as readonly string[]).includes(role)) return fail("Choose a role.");
  const set: Record<string, string> = {};
  for (const kind of SETTABLE_KINDS) {
    const v = String(fd.get(`ch_${kind}`) ?? "");
    if (!v) continue;
    if (!isChannel(v)) return fail("Choose in app, email, both or off.");
    set[kind] = isSafetyKind(kind) ? (v === "OFF" ? "APP" : v === "EMAIL" ? "BOTH" : v) : v;
  }
  const all = { ...(await getSetting("notificationRoleDefaults")) };
  if (Object.keys(set).length) all[role] = set; else delete all[role];
  await setSetting("notificationRoleDefaults", all);
  await logActivity("settings", 0, "updated", `Notification defaults for ${role}: ${Object.keys(set).length} kind(s) changed from the usual`, me.name);
  revalidatePath("/admin/notifications");
  return { message: "Defaults saved. People who chose for themselves keep their own choice." };
}

export async function saveEscalationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("settings.manage");
  const days: Record<string, number> = {};
  for (const e of ESCALATION_ENTITIES) {
    const v = Number(fd.get(`days_${e}`));
    if (!Number.isInteger(v) || v < 1 || v > 60) return fail("Working days must be a whole number from 1 to 60.");
    days[e] = v;
  }
  const minutes: Record<string, number> = {};
  for (const c of FAULT_CLASSES) {
    const v = Number(fd.get(`min_${c}`));
    if (!Number.isInteger(v) || v < 5 || v > 14400) return fail("Fault targets must be whole minutes from 5 to 14,400 (10 working days).");
    minutes[c] = v;
  }
  await setSetting("approvalEscalationDays", days);
  await setSetting("faultAckMinutes", minutes);
  await logActivity("settings", 0, "updated", `Escalation: approvals ${JSON.stringify(days)}; faults (minutes) ${JSON.stringify(minutes)}`, me.name);
  revalidatePath("/admin/notifications");
  return { message: "Escalation settings saved." };
}
