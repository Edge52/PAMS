import Link from "next/link";
import { Badge, Details, PageHeader, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requirePermission } from "@/lib/auth/session";
import { APP_TIME_ZONE, formatNumber } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { alertRunInProgress, lastAlertRun } from "@/lib/notifications/alerts";
import { MAINTENANCE_DUE_DAYS } from "@/lib/notifications/alert-rules";
import { emailStatus } from "@/lib/notifications/email";
import { kindLabel } from "@/lib/notifications/types";
import { checkAlertsNow, sendTestEmail } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email and alert settings" };

const at = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default async function NotificationSettingsPage() {
  const me = await requirePermission("settings.manage");
  const [email, s] = await Promise.all([emailStatus(), getSettings()]);
  const last = lastAlertRun();

  return (
    <>
      <PageHeader title="Email and alert settings" back={{ href: "/notifications", label: "Notifications" }}
        description="Check that notification emails reach people, and run the alert check without waiting for the hourly run." />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Email delivery">
          <Details items={[
            { label: "Status", value: email.active ? <Badge tone="ok">On</Badge> : <Badge tone="neutral">Off</Badge> },
            { label: "Switch in settings", value: email.enabled ? "On" : "Off" },
            { label: "Mail server (SMTP_URL, MAIL_FROM)", value: email.configured ? `Set, sending as ${email.from}` : "Not set" },
            { label: "Link base (APP_URL)", value: email.appUrl ?? "Not set: emails go out without a link" },
          ]} />
          <p className="mt-4 text-sm text-muted">
            Every notification is emailed to its recipient when the switch is on and the server has SMTP_URL and MAIL_FROM.
            {" "}Turn the switch on or off in <Link href="/admin/settings" className="text-primary hover:underline">settings</Link>.
          </p>
          <ActionForm action={sendTestEmail} className="mt-4">
            <SubmitButton variant="secondary" pendingLabel="Sending…">Send test email to {me.email}</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel title="Alert check">
          <Details items={[
            { label: "Offers expiring", value: `Within ${s.offerExpiryWarnDays} days, to procurement` },
            { label: "RFQs closing", value: `Within ${s.rfqClosingWarnDays} days, to procurement` },
            { label: "Warranties ending", value: `Within ${s.warrantyWarnDays} days, to biomedical engineers` },
            { label: "Maintenance", value: `Due within ${MAINTENANCE_DUE_DAYS} days or overdue, to biomedical engineers and technicians` },
            { label: "Purchase orders", value: "Past expected delivery, to procurement" },
            { label: "Acceptance notices", value: "Complaint window ended without an acceptance notice, to procurement" },
          ]} />
          <div className="mt-4 rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-sm">
            {alertRunInProgress() ? "A check is running now." : last ? (
              <>
                Last check {at(last.finishedAt)} ({last.trigger}, {formatNumber(last.ms)} ms): {formatNumber(last.created)} new from {formatNumber(last.candidates)} alerts.
                {Object.keys(last.byKind).length > 0 && (
                  <span className="block text-muted">{Object.entries(last.byKind).map(([k, n]) => `${kindLabel(k)} ${n}`).join(" · ")}</span>
                )}
                {last.error && <span className="block text-danger">Error: {last.error}</span>}
              </>
            ) : "No check has run since the server started. The first one runs shortly after start, then hourly."}
          </div>
          <ActionForm action={checkAlertsNow} className="mt-4">
            <SubmitButton pendingLabel="Checking…">Check alerts now</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">Alerts are never sent twice: running the check again only sends what is new. Change the windows in <Link href="/admin/settings" className="text-primary hover:underline">settings</Link>.</p>
        </Panel>
      </div>
    </>
  );
}
