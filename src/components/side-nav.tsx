"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Permission } from "@/lib/auth/permissions";

/**
 * App navigation. OWNED BY THE LEAD — module agents: the links for your module already exist below.
 * Build pages at these routes; if you need a new top-level link, say so in your report.
 */
type NavLink = { href: string; label: string; need?: Permission };
const sections: { title: string; links: NavLink[] }[] = [
  { title: "Overview", links: [
    { href: "/", label: "Dashboard" },
    { href: "/approvals", label: "Approvals" },
    { href: "/reports", label: "Reports", need: "reports.view" },
  ] },
  {
    title: "Hospital",
    links: [
      { href: "/facilities", label: "Facilities & floors", need: "assets.view" },
      { href: "/catalogue", label: "Device catalogue", need: "assets.view" },
    ],
  },
  {
    title: "Planning",
    links: [
      { href: "/boq", label: "BOQs", need: "boq.view" },
      { href: "/boq/standards", label: "Standards & ratios", need: "boq.view" },
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
    ],
  },
  {
    title: "Assets",
    links: [
      { href: "/assets", label: "Asset register", need: "assets.view" },
      { href: "/assets/map", label: "Floor map", need: "assets.view" },
      { href: "/assets/3d", label: "3D view", need: "assets.view" },
      { href: "/assets/work-orders", label: "Work orders", need: "assets.view" },
      { href: "/assets/maintenance", label: "Maintenance", need: "assets.view" },
    ],
  },
  {
    title: "Administration",
    links: [
      { href: "/admin/users", label: "Users", need: "users.manage" },
      { href: "/admin/settings", label: "Approval rules & settings", need: "settings.manage" },
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

export function SideNav({ perms }: { perms: Permission[] }) {
  const pathname = usePathname();
  const allowed = new Set(perms);
  const visible = sections
    .map((s) => ({ ...s, links: s.links.filter((l) => !l.need || allowed.has(l.need)) }))
    .filter((s) => s.links.length > 0);
  const [open, setOpen] = useState(false);

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
        {visible.map((s) => (
          <div key={s.title} className="mb-5">
            <p className="mb-1 px-2 text-xs font-semibold text-faint">{s.title}</p>
            <ul>
              {s.links.map((l) => {
                const active = isActive(pathname, l.href);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-[var(--radius-control)] px-2 py-1.5 text-[14px] ${
                        active ? "bg-primary-soft font-semibold text-primary-strong" : "text-ink hover:bg-sunken"
                      }`}
                    >
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
