"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission, requireUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import type { ActionState } from "@/lib/procurement/forms";
import { runAlerts } from "@/lib/notifications/alerts";
import { mailConfig, sendMail } from "@/lib/notifications/email";
import { markAllRead, markRead, markUnread } from "@/lib/notifications/inbox";
import { notificationEmail, safeHref } from "@/lib/notifications/types";

const Id = z.coerce.number().int().positive();

function refresh() {
  revalidatePath("/notifications");
  revalidatePath("/", "layout"); // the bell's unread count is in the layout
}

/** Open a notification: mark it read (only if it's the signed-in user's) and go to its link. */
export async function openNotification(fd: FormData) {
  const me = await requireUser();
  const id = Id.safeParse(fd.get("id"));
  if (!id.success) redirect("/notifications");
  const { found, href } = await markRead(me.id, id.data);
  refresh();
  if (!found) redirect("/notifications");
  redirect(safeHref(href) ?? "/notifications");
}

export async function toggleRead(fd: FormData) {
  const me = await requireUser();
  const id = Id.safeParse(fd.get("id"));
  if (!id.success) return;
  if (fd.get("to") === "unread") await markUnread(me.id, id.data);
  else await markRead(me.id, id.data);
  refresh();
}

export async function markAllReadAction() {
  const me = await requireUser();
  await markAllRead(me.id);
  refresh();
}

/** Admins: run the alert generator now. */
export async function checkAlertsNow(prev: ActionState): Promise<ActionState> {
  void prev;
  await requirePermission("settings.manage");
  const r = await runAlerts("manual");
  refresh();
  revalidatePath("/notifications/settings");
  if (r.error) return { errors: [`The check stopped with an error: ${r.error}`] };
  return { message: r.created === 0
    ? `Checked ${r.candidates} alert${r.candidates === 1 ? "" : "s"}: nothing new to send.`
    : `Sent ${r.created} new notification${r.created === 1 ? "" : "s"} (${r.candidates} alerts checked).` };
}

/** Admins: send a test email to themselves to check the SMTP settings. */
export async function sendTestEmail(prev: ActionState): Promise<ActionState> {
  void prev;
  const me = await requirePermission("settings.manage");
  const cfg = mailConfig();
  if (!cfg) return { errors: ["Email isn't set up on the server: set SMTP_URL and MAIL_FROM in the environment, then restart."] };
  const m = notificationEmail({
    title: "Test email from Hospital PAMS",
    body: `If you can read this, notification emails can reach ${me.email}.`,
    href: "/notifications",
  }, cfg.appUrl);
  try {
    await sendMail(me.email, m.subject, m.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] test email failed:", msg);
    return { errors: [`The mail server refused the test email: ${msg}`] };
  }
  await logActivity("settings", 0, "test_email", `Sent a test email to ${me.email}`);
  return { message: `Test email sent to ${me.email}.` };
}
