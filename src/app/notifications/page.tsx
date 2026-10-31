import Link from "next/link";
import { Badge, Button, EmptyState, LinkButton, PageHeader, TabLinks, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { APP_TIME_ZONE } from "@/lib/format";
import { INBOX_PAGE, inboxCounts, listInbox } from "@/lib/notifications/inbox";
import { kindLabel } from "@/lib/notifications/types";
import { checkAlertsNow, markAllReadAction, openNotification, toggleRead } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };

const TONE: Record<string, Tone> = {
  approval_needed: "primary", maintenance_overdue: "danger", po_late: "danger", acceptance_notice_due: "warn",
  offer_expiring: "warn", rfq_closing: "warn", warranty_ending: "info", maintenance_due: "info",
};

function when(d: Date): string {
  return d.toLocaleString("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const show = one(sp, "show") === "unread" ? "unread" : "all";
  const before = Number(one(sp, "before")) || undefined;
  const [counts, rows] = await Promise.all([
    inboxCounts(me.id),
    listInbox(me.id, { unreadOnly: show === "unread", before, limit: INBOX_PAGE + 1 }),
  ]);
  const more = rows.length > INBOX_PAGE;
  const list = rows.slice(0, INBOX_PAGE);
  const isAdmin = can(me.role, "settings.manage");

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Approvals waiting for you and alerts about offers, deliveries, warranties and maintenance. Open one to go straight to the record."
        actions={<>
          {counts.unread > 0 && (
            <form action={markAllReadAction}><Button variant="secondary">Mark all as read</Button></form>
          )}
          {isAdmin && <LinkButton href="/notifications/settings">Email and alert settings</LinkButton>}
        </>}
      />

      {isAdmin && (
        <ActionForm action={checkAlertsNow} className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <SubmitButton variant="secondary" pendingLabel="Checking…">Check alerts now</SubmitButton>
          <span className="text-muted">The check also runs on its own every hour.</span>
        </ActionForm>
      )}

      <TabLinks active={show} tabs={[
        { key: "all", label: `All (${counts.all})`, href: "/notifications" },
        { key: "unread", label: `Unread (${counts.unread})`, href: "/notifications?show=unread" },
      ]} />

      {list.length === 0 ? (
        show === "unread" && counts.all > 0 ? (
          <EmptyState title="You're all caught up" action={<LinkButton href="/notifications">Show all notifications</LinkButton>}>
            Nothing unread. Older notifications stay in the All tab.
          </EmptyState>
        ) : (
          <EmptyState title="No notifications yet">
            You&apos;ll be told here when something needs your approval, an offer or warranty is about to run out, a delivery is late or maintenance is due.
          </EmptyState>
        )
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          {list.map((n) => {
            const unread = !n.readAt;
            return (
              <li key={n.id} className={`flex items-start gap-2 ${unread ? "border-l-4 border-l-primary bg-primary-soft/50" : "border-l-4 border-l-transparent"}`}>
                <form action={openNotification} className="min-w-0 flex-1">
                  <input type="hidden" name="id" value={n.id} />
                  <button type="submit" className="block w-full px-4 py-3 text-left hover:bg-sunken/60 focus-visible:bg-sunken/60">
                    <span className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge tone={TONE[n.kind] ?? "neutral"}>{kindLabel(n.kind)}</Badge>
                      {unread && <span className="text-xs font-semibold text-primary-strong">Unread</span>}
                      <span className="text-xs text-muted">{when(n.createdAt)}</span>
                    </span>
                    <span className={`block text-[15px] ${unread ? "font-semibold text-ink" : "text-ink"}`}>{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
                  </button>
                </form>
                <form action={toggleRead} className="shrink-0 px-3 py-3">
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="to" value={unread ? "read" : "unread"} />
                  <button type="submit" className="rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                    aria-label={`${unread ? "Mark as read" : "Mark as unread"}: ${n.title}`}>
                    {unread ? "Mark as read" : "Mark as unread"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {(more || before) && (
        <div className="mt-4 flex gap-3 text-sm">
          {before && <Link href={show === "unread" ? "/notifications?show=unread" : "/notifications"} className="text-primary hover:underline">Back to newest</Link>}
          {more && (
            <Link href={`/notifications?${show === "unread" ? "show=unread&" : ""}before=${list[list.length - 1].id}`} className="text-primary hover:underline">
              Show older
            </Link>
          )}
        </div>
      )}
    </>
  );
}
