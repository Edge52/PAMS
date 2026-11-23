/**
 * Shared list table (wave 38, audit U4). Drawn on the server:
 *  - sorting by links in the address (`?sort=col&dir=desc`), so it works without JavaScript and the page keeps sorting
 *    in its own query. The page validates the key with `tableSort(sp, ALLOWED)` and passes the result as `sort`.
 *  - a column chooser for `optional` columns, remembered in this browser;
 *  - a header that stays on screen on wide screens, and horizontal scrolling at phone width (as <Table>);
 *  - optional row ticks with a bulk-actions bar: a server action, or a page opened with the ids (`?ids=1&ids=2`);
 *  - an empty state when there are no rows.
 *
 *   <DataTable id="suppliers" label="Suppliers" path="/procurement/suppliers" sp={sp} sort={sort} rows={rows}
 *     rowKey={(r) => r.id} columns={[{ key: "name", label: "Supplier", sort: true, cell: (r) => r.name }, …]}
 *     select={{ rowLabel: (r) => r.name, actions: [{ label: "Print labels for selected", action: "/assets/labels" }] }}
 *     empty={<EmptyState title="No suppliers yet" />} />
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { Sort } from "@/lib/list";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/components/ui";
import { ariaSort, sortHref, type Params } from "./data-table-utils";
import { BulkBar, ColumnChooser, SelectAll, type BulkActionProps } from "./data-table-client";

export type Column<R> = {
  /** Unique in the table; also the sort key when `sort` is true. Letters, digits, - and _. */
  key: string;
  /** Heading text (also used by the column chooser). */
  label: string;
  /** Heading content when it should differ from `label` (e.g. visually hidden text). */
  head?: ReactNode;
  cell: (row: R) => ReactNode;
  /** Sortable: true sorts by `key`; a string sorts by that key. The page must allow the key. */
  sort?: boolean | string;
  align?: "right" | "center";
  /** Classes for the heading and the cells, e.g. "hidden md:table-cell" to drop it at phone width. */
  className?: string;
  /** Classes for the cells only (type size, fonts), so the heading keeps the table's heading style. */
  cellClassName?: string;
  /** Can be switched off in the column chooser. */
  optional?: boolean;
  /** Off until the user switches it on (needs `optional`). */
  hidden?: boolean;
};

export type DataTableProps<R> = {
  id: string;
  /** What the table lists, read out by screen readers ("Asset register"). */
  label: string;
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => string | number;
  /** The page's own address and search params, for the sort links. */
  path: string;
  sp: Params;
  /** The sort in effect, already checked against the page's allow-list (null = the list's own order). */
  sort: Sort<string> | null;
  rowClassName?: (row: R) => string | undefined;
  /** Row ticks and what can be done with the ticked rows. Ticked ids are sent as `name` (default "ids"). */
  select?: { name?: string; rowLabel: (row: R) => string; actions: BulkActionProps[]; what?: string; extra?: ReactNode };
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Beside the column chooser, above the table (counts, export links). */
  toolbar?: ReactNode;
  /** Under the table, beside the bulk actions (pager, totals). */
  footer?: ReactNode;
};

const alignCls = (a?: "right" | "center") => (a === "right" ? "text-right" : a === "center" ? "text-center" : undefined);

export function DataTable<R>({ id, label, columns, rows, rowKey, path, sp, sort, rowClassName, select, empty, toolbar, footer }: DataTableProps<R>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const formId = `${id}-selected`, name = select?.name ?? "ids";
  const chooser = columns.some((c) => c.optional);
  return (
    <div data-dt={id}>
      {(chooser || toolbar) && (
        <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
          {toolbar && <div className="mr-auto flex flex-wrap items-center gap-2 text-sm">{toolbar}</div>}
          {chooser && <ColumnChooser id={id} columns={columns.map(({ key, label: l, optional, hidden }) => ({ key, label: l, optional, hidden }))} />}
        </div>
      )}
      {select && <form id={formId} />}
      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-card)] xl:overflow-x-visible [&_thead_th:first-child]:rounded-tl-[var(--radius-panel)] [&_thead_th:last-child]:rounded-tr-[var(--radius-panel)]">
        <table aria-label={label} className="w-full border-collapse text-[14px]">
          <thead className="bg-sunken text-left text-[11px] uppercase tracking-[0.1em] text-muted xl:sticky xl:top-0 xl:z-10 [&_th]:bg-sunken">
            <tr>
              {select && (
                <th scope="col" className="w-8 border-b border-line px-3 py-2.5">
                  <SelectAll form={formId} name={name} label={`Select every ${select.what ?? "row"} on this page`} />
                </th>
              )}
              {columns.map((c) => {
                const k = typeof c.sort === "string" ? c.sort : c.sort ? c.key : null;
                const on = k !== null && sort?.key === k;
                return (
                  <th key={c.key} scope="col" data-col={c.key} aria-sort={k ? ariaSort(sort, k) : undefined}
                    className={cx("whitespace-nowrap border-b border-line px-3 py-2.5 font-semibold", alignCls(c.align), c.className)}>
                    {k ? (
                      <Link href={sortHref(path, sp, k, sort)} scroll={false}
                        title={on ? (sort?.dir === "asc" ? "Sorted A to Z. Click for Z to A." : "Sorted Z to A. Click to clear.") : "Sort by this column"}
                        className={cx("inline-flex min-h-6 items-center gap-1 hover:text-ink", on && "text-ink")}>
                        {c.head ?? c.label}
                        {on ? <Icon name={sort?.dir === "asc" ? "arrowUp" : "arrowDown"} size={12} /> : <span aria-hidden className="w-3 text-center opacity-40">↕</span>}
                      </Link>
                    ) : (c.head ?? c.label)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = rowKey(r);
              return (
                <tr key={key} className={cx("hover:bg-canvas", rowClassName?.(r))}>
                  {select && (
                    <td className="w-8 border-b border-line px-3 py-2.5 align-top">
                      <input type="checkbox" name={name} value={key} form={formId} aria-label={`Select ${select.rowLabel(r)}`} className="size-4 accent-[var(--color-primary)]" />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} data-col={c.key} className={cx("border-b border-line px-3 py-2.5 align-top", alignCls(c.align), c.className, c.cellClassName)}>{c.cell(r)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(select || footer) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {select ? <div className="flex flex-wrap items-center gap-2"><BulkBar form={formId} name={name} actions={select.actions} what={select.what ?? "rows"} />{select.extra}</div> : <span />}
          {footer}
        </div>
      )}
    </div>
  );
}
