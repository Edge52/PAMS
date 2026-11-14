"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { nextSort, type Dir } from "@/lib/list";
import { Icon } from "@/components/ui/icons";

/**
 * A column heading that sorts its list (wave 21). Clicking cycles ascending, descending, off; the choice lives in the
 * address (`?sort=…&dir=…`), so it can be shared and saved. The page reads it with `parseSort` from `@/lib/list`.
 */
export function SortTh({ k, children, align, className }: { k: string; children: ReactNode; align?: "right"; className?: string }) {
  const pathname = usePathname(), sp = useSearchParams();
  const key = sp.get("sort"), dir: Dir = sp.get("dir") === "desc" ? "desc" : "asc";
  const on = key === k;
  const next = nextSort(key ? { key, dir } : null, k);
  const q = new URLSearchParams(sp);
  q.delete("page");
  if (next) { q.set("sort", next.key); if (next.dir === "desc") q.set("dir", "desc"); else q.delete("dir"); } else { q.delete("sort"); q.delete("dir"); }
  const href = q.size ? `${pathname}?${q}` : pathname;
  return (
    <th aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className={`whitespace-nowrap border-b border-line px-3 py-2.5 font-semibold ${align === "right" ? "text-right" : ""} ${className ?? ""}`}>
      <Link href={href} scroll={false} title={on ? (dir === "asc" ? "Sorted A to Z. Click for Z to A." : "Sorted Z to A. Click to clear.") : "Sort by this column"}
        className={`inline-flex min-h-6 items-center gap-1 hover:text-ink ${on ? "text-ink" : ""}`}>
        {children}
        {on ? <Icon name={dir === "asc" ? "arrowUp" : "arrowDown"} size={12} /> : <span aria-hidden className="w-3 text-center opacity-40">↕</span>}
      </Link>
    </th>
  );
}
