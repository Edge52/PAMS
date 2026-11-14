"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Permission } from "@/lib/auth/permissions";
import { activeHref, moduleOf, modulesFor, orderModules, OVERVIEW, type NavLink } from "@/lib/modules";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * App navigation. OWNED BY THE LEAD. The links live in `src/lib/modules.ts`: add a page to its module there.
 *
 * Wave 21: the menu shows one module at a time. On a module's page it lists that module's links; elsewhere
 * (dashboard, modules page) it lists the modules. Pinned links stay at the top everywhere.
 */
const PIN_KEY = "pams.nav.pinned";
const readList = (k: string): string[] | null => { try { const v = window.localStorage.getItem(k); return v ? (JSON.parse(v) as string[]) : null; } catch { return null; } };
const writeList = (k: string, v: string[]) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: not remembered */ } };

const item = "flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-[14px]";

export function SideNav({ perms, assistant = false, role = null }: { perms: Permission[]; assistant?: boolean; role?: string | null }) {
  const pathname = usePathname();
  const modules = orderModules(modulesFor(perms), role);
  const current = modules.find((m) => m.id === moduleOf(pathname)?.id) ?? null;
  const active = activeHref(pathname);
  const overview = OVERVIEW.filter((l) => l.flag !== "assistant" || assistant);
  const [open, setOpen] = useState(false);
  // Wave 22: on the 3D view the menu tucks away at every width (the Menu button brings it back), so the model gets the whole window.
  const tucked = pathname.startsWith("/assets/3d");
  useEffect(() => {
    if (tucked) document.body.dataset.navTucked = "1"; else delete document.body.dataset.navTucked;
    return () => { delete document.body.dataset.navTucked; };
  }, [tucked]);
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setPinned(readList(PIN_KEY) ?? []), 0);
    return () => clearTimeout(t);
  }, []);
  const togglePin = (href: string) => {
    const next = pinned.includes(href) ? pinned.filter((h) => h !== href) : [...pinned, href].slice(-8);
    setPinned(next); writeList(PIN_KEY, next);
  };
  const allLinks = modules.flatMap((m) => m.links);
  const pins = pinned.map((h) => allLinks.find((l) => l.href === h)).filter((l): l is NavLink => !!l);

  const link = (l: NavLink, opts: { pin?: boolean; icon?: IconName; canPin?: boolean } = {}) => {
    const on = active === l.href, isPinned = pinned.includes(l.href);
    return (
      <li key={`${opts.pin ? "p" : ""}${l.href}`} className="group relative">
        <Link href={l.href} onClick={() => setOpen(false)} aria-current={on ? "page" : undefined}
          className={`${item} ${opts.canPin ? "pr-9" : ""} ${on ? "bg-nav-raised font-semibold text-white" : "text-nav-ink hover:bg-nav-raised/60 hover:text-white"}`}>
          {opts.icon ? <Icon name={opts.icon} size={17} className={on ? "text-nav-gold" : "text-nav-muted"} />
            : <span aria-hidden className={`size-1.5 rounded-full ${on ? "bg-nav-gold" : "bg-transparent"}`} />}
          {l.label}
        </Link>
        {opts.canPin && (
          <button type="button" onClick={() => togglePin(l.href)} aria-label={isPinned ? `Unpin ${l.label}` : `Pin ${l.label} to the top`} title={isPinned ? "Unpin" : "Pin to the top"}
            className={`absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded ${isPinned ? "text-nav-gold" : "text-nav-muted opacity-0 group-hover:opacity-100 focus:opacity-100"}`}>
            <Icon name="star" size={14} />
          </button>
        )}
      </li>
    );
  };
  const heading = "mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-nav-muted";

  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="side-nav"
        className={`fixed left-3 top-3 z-40 rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-semibold ${tucked ? "" : "md:hidden"}`}>
        {open ? "Close" : "Menu"}
      </button>
      <nav id="side-nav" aria-label="Main menu"
        className={`${open ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col gap-6 overflow-y-auto bg-nav px-4 py-6 pt-14 transition-transform md:pt-6 ${tucked ? "md:pt-14" : "md:sticky md:top-0 md:h-screen md:translate-x-0"}`}>
        <Link href="/" className="flex items-center gap-3 px-2" onClick={() => setOpen(false)}>
          <span className="grid size-9 place-items-center rounded-[10px] border border-nav-gold font-display text-xl text-nav-gold">P</span>
          <span className="leading-tight">
            <span className="block font-display text-[19px] text-white">Hospital PAMS</span>
            <span className="block text-[11px] uppercase tracking-[0.14em] text-nav-muted">Procurement &amp; assets</span>
          </span>
        </Link>
        <ul className="space-y-0.5">
          {overview.map((l) => link(l, { icon: l.href === "/" ? "home" : l.href === "/modules" ? "grid" : l.href === "/approvals" ? "check" : "inbox" }))}
        </ul>
        {pins.length > 0 && (
          <div>
            <p className={heading}>Pinned</p>
            <ul className="space-y-0.5">{pins.map((l) => link(l, { pin: true, canPin: true }))}</ul>
          </div>
        )}
        {current ? (
          <div>
            <p className={heading}>Module</p>
            <p className="mb-2 flex items-center gap-2 px-3 font-display text-[24px] leading-tight text-nav-gold"><Icon name={current.id} size={20} />{current.name}</p>
            <ul className="space-y-0.5">{current.links.map((l) => link(l, { canPin: true }))}</ul>
          </div>
        ) : (
          <div>
            <p className={heading}>Modules</p>
            <ul className="space-y-0.5">{modules.map((m) => link({ href: m.links[0].href, label: m.name }, { icon: m.id }))}</ul>
          </div>
        )}
      </nav>
    </>
  );
}
