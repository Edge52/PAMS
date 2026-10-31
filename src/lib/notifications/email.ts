import "server-only";
/**
 * Optional email delivery for notifications (nodemailer over SMTP).
 * On only when the admin switch `emailEnabled` is true AND SMTP_URL + MAIL_FROM are set.
 * Never throws into the caller: notifications are saved first, emails go out afterwards and failures are logged.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { notificationEmail } from "./types";

export type MailConfig = { smtpUrl: string; from: string; appUrl: string | null };

/** SMTP settings from the environment, or null when they're missing. */
export function mailConfig(): MailConfig | null {
  const smtpUrl = process.env.SMTP_URL?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!smtpUrl || !from) return null;
  return { smtpUrl, from, appUrl: process.env.APP_URL?.trim() || null };
}

const g = globalThis as unknown as { hpamsMailer?: { url: string; t: Transporter } };

function transporter(cfg: MailConfig): Transporter {
  if (g.hpamsMailer?.url !== cfg.smtpUrl) {
    g.hpamsMailer = { url: cfg.smtpUrl, t: nodemailer.createTransport(cfg.smtpUrl) };
  }
  return g.hpamsMailer.t;
}

export type EmailStatus = { configured: boolean; enabled: boolean; active: boolean; from: string | null; appUrl: string | null };

export async function emailStatus(): Promise<EmailStatus> {
  const cfg = mailConfig();
  const enabled = Boolean(await getSetting("emailEnabled"));
  return { configured: !!cfg, enabled, active: !!cfg && enabled, from: cfg?.from ?? null, appUrl: cfg?.appUrl ?? null };
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const cfg = mailConfig();
  if (!cfg) throw new Error("Email isn't set up: SMTP_URL and MAIL_FROM are missing.");
  await transporter(cfg).sendMail({ from: cfg.from, to, subject, text });
}

/** Email the given (newly created) notifications when email is on. Safe to call without awaiting. */
export async function emailNotifications(ids: number[]): Promise<number> {
  try {
    if (!ids.length) return 0;
    const cfg = mailConfig();
    if (!cfg) return 0;
    if (!(await getSetting("emailEnabled"))) return 0;
    const rows = await db.select({
      id: notifications.id, title: notifications.title, body: notifications.body, href: notifications.href,
      email: users.email, active: users.active,
    }).from(notifications).innerJoin(users, eq(users.id, notifications.userId))
      .where(and(inArray(notifications.id, ids), isNull(notifications.emailedAt)));
    let sent = 0;
    for (const r of rows) {
      if (!r.active || !r.email) continue;
      try {
        const m = notificationEmail(r, cfg.appUrl);
        await transporter(cfg).sendMail({ from: cfg.from, to: r.email, subject: m.subject, text: m.text });
        await db.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, r.id));
        sent++;
      } catch (e) {
        console.error(`[notifications] email to ${r.email} failed:`, e instanceof Error ? e.message : e);
      }
    }
    return sent;
  } catch (e) {
    console.error("[notifications] email delivery failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}
