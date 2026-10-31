import Link from "next/link";
import { unreadCount } from "@/lib/notifications/inbox";

/** Top-bar bell: links to the inbox and shows how many notifications are unread. OWNED BY: notifications agent. */
export async function NotificationBell({ userId }: { userId: number }) {
  let unread = 0;
  try { unread = await unreadCount(userId); } catch (e) { console.error("[notifications] unread count failed:", e); }
  const label = unread === 0 ? "Notifications, none unread" : `Notifications, ${unread} unread`;
  const badge = unread > 99 ? "99+" : String(unread);
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="no-print relative grid size-9 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-sunken hover:text-ink"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8.5 3 8.5H3S6 15 6 8" />
        <path d="M10.3 20a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-[1.15rem] rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-[1.15rem] text-white">
          {badge}
        </span>
      )}
    </Link>
  );
}
