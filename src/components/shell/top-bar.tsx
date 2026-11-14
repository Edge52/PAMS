import Link from "next/link";
import { permissionsOf, ROLE_LABELS } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { signOut } from "@/app/login/actions";
import { NotificationBell } from "@/components/notification-bell";
import { CommandPalette } from "@/components/shell/command-palette";
import { PathBar } from "@/components/shell/path-bar";

/** Right-hand bar above every page: notifications and the signed-in user's menu. */
export function TopBar({ user, assistant = false }: { user: CurrentUser; assistant?: boolean }) {
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return (
    <>
    <div className="topbar-row mb-5 flex items-center justify-end gap-2 pl-24 md:pl-0">
      <form action="/search" role="search" className="mr-auto min-w-0 flex-1 sm:max-w-sm md:ml-0">
        <label htmlFor="global-search" className="sr-only">Search everything</label>
        <input id="global-search" type="search" name="q" placeholder="Search equipment, rooms, suppliers…" autoComplete="off"
          className="min-h-9 w-full rounded-full border border-line bg-surface px-4 py-1.5 text-sm placeholder:text-faint focus:border-primary focus:outline-none" />
      </form>
      <CommandPalette perms={permissionsOf(user.role)} assistant={assistant} />
      <NotificationBell userId={user.id} />
      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 hover:bg-sunken [&::-webkit-details-marker]:hidden">
          <span className="grid size-9 place-items-center rounded-full bg-nav text-xs font-semibold text-nav-gold" aria-hidden>{initials}</span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-semibold">{user.name}</span>
            <span className="block text-xs text-muted">{ROLE_LABELS[user.role]}</span>
          </span>
        </summary>
        <div className="absolute right-0 z-40 mt-1 w-52 rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-lg">
          <Link href="/account" className="block rounded-[var(--radius-control)] px-3 py-2 text-sm hover:bg-sunken">Your account</Link>
          <form action={signOut}>
            <button type="submit" className="block w-full rounded-[var(--radius-control)] px-3 py-2 text-left text-sm hover:bg-sunken">Sign out</button>
          </form>
        </div>
      </details>
    </div>
    <PathBar />
    </>
  );
}
