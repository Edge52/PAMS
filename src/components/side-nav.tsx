"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Permission } from "@/lib/auth/permissions";

/**
 * App navigation. OWNED BY THE LEAD — module agents: the links for your module already exist below.
 * Build pages at these routes; if you need a new top-level link, say so in your report.
 */
type NavLink = { href: string; label: string; need?: Permission; flag?: "assistant" };
const sections: { title: string; links: NavLink[] }[] = [
  { title: "Overview", links: [
    { href: "/", label: "Dashboard" },
    { href: "/approvals", label: "Approvals" },
    { href: "/reports", label: "Reports", need: "reports.view" },
    { href: "/assistant", label: "Assistant", flag: "assistant" },
  ] },
  {
    title: "Hospital",
    links: [
      { href: "/facilities", label: "Facilities & floors", need: "assets.view" },
      { href: "/facilities/room-standards", label: "Room standards", need: "assets.view" },
      { href: "/catalogue", label: "Device catalogue", need: "assets.view" },
    ],
  },
  {
    title: "Planning",
    links: [
      { href: "/boq", label: "BOQs", need: "boq.view" },
      { href: "/boq/standards", label: "Standards & ratios", need: "boq.view" },
      { href: "/boq/room-kits", label: "Room kits", need: "boq.view" },
      { href: "/flows", label: "Patient pathways", need: "assets.view" },
    ],
  },
  {
    title: "Procurement",
    links: [
      { href: "/procurement", label: "Projects & tenders", need: "procurement.view" },
      { href: "/procurement/rfqs", label: "RFQs", need: "procurement.view" },
      { href: "/procurement/suppliers", label: "Suppliers", need: "procurement.view" },
      { href: "/procurement/offers", label: "Offers", need: "procurement.view" },
      { href: "/procurement/purchase-orders", label: "Purchase orders", need: "procurement.view" },
      { href: "/procurement/frameworks", label: "Framework agreements", need: "procurement.view" },
      { href: "/procurement/invoices", label: "Invoices", need: "procurement.view" },
      { href: "/procurement/budgets", label: "Budgets", need: "procurement.view" },
    ],
  },
  {
    title: "Assets",
    links: [
      { href: "/assets", label: "Asset register", need: "assets.view" },
      { href: "/assets/3d", label: "3D view", need: "assets.view" },
      { href: "/assets/map", label: "Floor map", need: "assets.view" },
      { href: "/assets/work-orders", label: "Work orders", need: "assets.view" },
      { href: "/assets/maintenance", label: "Maintenance", need: "assets.view" },
      { href: "/assets/department", label: "My department", need: "assets.view" },
      { href: "/assets/requests", label: "Equipment requests", need: "assets.view" },
    ],
  },
  {
    title: "Asset management",
    links: [
      { href: "/assets/contracts", label: "Service contracts", need: "assets.view" },
      { href: "/assets/parts", label: "Spare parts", need: "assets.view" },
      { href: "/assets/recalls", label: "Recalls", need: "assets.view" },
      { href: "/assets/rounds", label: "Rounds and stock-take", need: "assets.view" },
      { href: "/assets/fleet", label: "Fleet & standardisation", need: "assets.view" },
      { href: "/assets/imaging", label: "Imaging use", need: "assets.view" },
      { href: "/assets/replacement", label: "Replacement plan", need: "assets.view" },
      { href: "/assets/capital-plan", label: "Capital plan", need: "assets.view" },
      { href: "/assets/commissioning", label: "Commissioning", need: "assets.view" },
      { href: "/assets/disposals", label: "Disposals", need: "assets.view" },
    ],
  },
  {
    title: "Administration",
    links: [
      { href: "/admin/users", label: "Users", need: "users.manage" },
      { href: "/admin/settings", label: "Approval rules & settings", need: "settings.manage" },
      { href: "/admin/audit", label: "Audit log", need: "users.manage" },
      { href: "/admin/backups", label: "Backups", need: "users.manage" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  // Most specific link wins: /boq should not light up on /boq/standards.
  const all = sections.flatMap((s) => s.links.map((l) => l.href));
  const matches = all.filter((h) => h !== "/" && (pathname === h || pathname.startsWith(h + "/")));
  const best = matches.sort((a, b) => b.length - a.length)[0];
  return best === href;
}

/**
 * Wave 19: the groups in the order each role uses them (their own work first), so the links a person needs most are
 * at the top. Groups not listed keep the default order after these.
 */
export const ROLE_ORDER: Record<string, string[]> = {
  TECHNICIAN: ["Overview", "Assets", "Asset management", "Hospital"],
  BIOMEDICAL: ["Overview", "Assets", "Asset management", "Hospital", "Planning"],
  DEPARTMENT_HEAD: ["Overview", "Assets", "Planning"],
  PROCUREMENT: ["Overview", "Procurement", "Planning"],
  FINANCE: ["Overview", "Procurement", "Asset management"],
  PLANNER: ["Overview", "Planning", "Hospital", "Assets"],
  DIRECTOR: ["Overview", "Assets", "Procurement", "Planning"],
  ADMIN: ["Overview", "Assets", "Procurement", "Planning", "Hospital", "Asset management"],
};
export function orderSections<T extends { title: string }>(list: T[], role: string | null | undefined): T[] {
  const order = ROLE_ORDER[role ?? ""] ?? [];
  const rank = (t: string) => { const i = order.indexOf(t); return i < 0 ? order.length + list.findIndex((x) => x.title === t) : i; };
  return [...list].sort((a, b) => rank(a.title) - rank(b.title));
}

const PIN_KEY = "pams.nav.pinned", CLOSED_KEY = "pams.nav.closed";
const readList = (k: string): string[] | null => { try { const v = window.localStorage.getItem(k); return v ? (JSON.parse(v) as string[]) : null; } catch { return null; } };
const writeList = (k: string, v: string[]) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: not remembered */ } };

export function SideNav({ perms, assistant = false, role = null }: { perms: Permission[]; assistant?: boolean; role?: string | null }) {
  const pathname = usePathname();
  const allowed = new Set(perms);
  const visible = orderSections(sections
    .map((s) => ({ ...s, links: s.links.filter((l) => (!l.need || allowed.has(l.need)) && (l.flag !== "assistant" || assistant)) }))
    .filter((s) => s.links.length > 0), role);
  const [open, setOpen] = useState(false);
  // Pinned links (top of the menu) and folded groups, remembered in this browser.
  const [pinned, setPinned] = useState<string[]>([]);
  const [closed, setClosed] = useState<string[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setPinned(readList(PIN_KEY) ?? []); setClosed(readList(CLOSED_KEY)); }, 0);
    return () => clearTimeout(t);
  }, []);
  // First visit: the role's first three groups open, the rest folded. The group of the page shown is always open.
  const isClosed = (title: string) => {
    if (visible.find((s) => s.title === title)?.links.some((l) => isActive(pathname, l.href))) return false;
    return closed ? closed.includes(title) : visible.findIndex((s) => s.title === title) >= 3;
  };
  const toggle = (title: string) => {
    const now = visible.filter((s) => isClosed(s.title)).map((s) => s.title);
    const next = now.includes(title) ? now.filter((t) => t !== title) : [...now, title];
    setClosed(next); writeList(CLOSED_KEY, next);
  };
  const togglePin = (href: string) => {
    const next = pinned.includes(href) ? pinned.filter((h) => h !== href) : [...pinned, href].slice(-8);
    setPinned(next); writeList(PIN_KEY, next);
  };
  const allLinks = visible.flatMap((s) => s.links);
  const pins = pinned.map((h) => allLinks.find((l) => l.href === h)).filter((l): l is NavLink => !!l);
  const link = (l: NavLink, pin: boolean) => {
    const active = isActive(pathname, l.href), isPinned = pinned.includes(l.href);
    return (
      <li key={`${pin ? "p" : ""}${l.href}`} className="group relative">
        <Link href={l.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
          className={`block rounded-[var(--radius-control)] py-1.5 pl-2 pr-7 text-[14px] ${active ? "bg-primary-soft font-semibold text-primary-strong" : "text-ink hover:bg-sunken"}`}>
          {l.label}
        </Link>
        <button type="button" onClick={() => togglePin(l.href)} aria-label={isPinned ? `Unpin ${l.label}` : `Pin ${l.label} to the top`} title={isPinned ? "Unpin" : "Pin to the top"}
          className={`absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-xs ${isPinned ? "text-primary" : "text-faint opacity-0 group-hover:opacity-100 focus:opacity-100"}`}>{isPinned ? "★" : "☆"}</button>
      </li>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed left-3 top-3 z-40 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm md:hidden"
        aria-expanded={open}
        aria-controls="side-nav"
      >
        {open ? "Close" : "Menu"}
      </button>
      <nav
        id="side-nav"
        className={`${open ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-30 w-60 shrink-0 overflow-y-auto border-r border-line bg-surface px-3 py-5 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0`}
      >
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2" onClick={() => setOpen(false)}>
          <span className="grid size-8 place-items-center rounded-[var(--radius-control)] bg-primary text-sm font-bold text-white">
            H
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold">Hospital PAMS</span>
            <span className="block text-xs text-muted">Procurement & assets</span>
          </span>
        </Link>
        {pins.length > 0 && (
          <div className="mb-4">
            <p className="mb-1 px-2 text-xs font-semibold text-faint">Pinned</p>
            <ul>{pins.map((l) => link(l, true))}</ul>
          </div>
        )}
        {visible.map((s) => {
          const shut = isClosed(s.title);
          return (
            <div key={s.title} className="mb-3">
              <button type="button" onClick={() => toggle(s.title)} aria-expanded={!shut}
                className="mb-1 flex w-full items-center justify-between rounded px-2 py-0.5 text-left text-xs font-semibold text-faint hover:text-ink">
                <span>{s.title}</span><span aria-hidden className="text-[10px]">{shut ? `${s.links.length} ▸` : "▾"}</span>
              </button>
              {!shut && <ul>{s.links.map((l) => link(l, false))}</ul>}
            </div>
          );
        })}
      </nav>
    </>
  );
}
