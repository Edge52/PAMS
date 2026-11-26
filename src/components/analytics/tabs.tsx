"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** The Analytics tab bar: marks the tab you are on and keeps the filters when you switch tabs. */
export function AnalyticsTabBar({ tabs }: { tabs: { id: string; label: string; href: string }[] }) {
  const path = usePathname();
  const q = useSearchParams().toString();
  const active = [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => path === t.href || path.startsWith(t.href + "/"));
  return (
    <nav aria-label="Analytics tabs" className="no-print mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = active?.id === t.id;
        return (
          <Link key={t.id} href={q ? `${t.href}?${q}` : t.href} aria-current={on ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${on ? "border-primary font-semibold text-primary-strong" : "border-transparent text-muted hover:text-ink"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
