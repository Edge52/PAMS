/**
 * Pager under a paged list (wave 41): "Showing 51–100 of 734 offers" and the page links. Links keep the list's
 * filters and sort (`pageHref`). Drawn on the server; use it as DataTable's `footer`.
 */
import Link from "next/link";
import { cx } from "@/components/ui";
import { pageHref, pageLinks, shownLine, type Paging } from "@/lib/paging";

type Params = Record<string, string | string[] | undefined>;

export function ListPager({ paging, path, sp, what }: { paging: Paging; path: string; sp: Params; what: string }) {
  const links = pageLinks(paging.page, paging.pages);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted" aria-live="polite">{shownLine(paging, what)}</span>
      {links.length > 0 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-1">
          {paging.page > 1 && <Link href={pageHref(path, sp, paging.page - 1)} className="rounded px-2 py-1 hover:bg-sunken">‹ Previous</Link>}
          {links.map((p, i) => p === 0 ? <span key={`gap${i}`} className="px-1 text-faint">…</span> : (
            <Link key={p} href={pageHref(path, sp, p)} aria-current={p === paging.page ? "page" : undefined}
              className={cx("rounded px-2 py-1", p === paging.page ? "bg-primary font-semibold text-on-primary" : "hover:bg-sunken")}>{p}</Link>
          ))}
          {paging.page < paging.pages && <Link href={pageHref(path, sp, paging.page + 1)} className="rounded px-2 py-1 hover:bg-sunken">Next ›</Link>}
        </nav>
      )}
    </div>
  );
}
