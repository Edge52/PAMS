import Link from "next/link";
import type { ReactNode } from "react";
import { Table, THead, Th, Td } from "@/components/ui";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { Cell, Column, Row, Section } from "@/lib/reports/types";

const TONE_CLASS = { danger: "text-danger font-semibold", warn: "text-warn font-semibold", ok: "text-ok font-semibold" } as const;

function show(col: Column, row: Row): string {
  const v: Cell = row[col.key];
  if (v === null || v === undefined || v === "") return col.type === "money" || col.type === "egp" ? "" : "—";
  switch (col.type) {
    case "date": return formatDate(String(v));
    case "int": return formatNumber(v);
    case "days": return typeof v === "number" ? (v === 0 ? "0" : `${formatNumber(v)} day${Math.abs(v) === 1 ? "" : "s"}`) : String(v);
    case "pct": return `${formatNumber(v, 1)}%`;
    case "egp": return formatMoney(v, "EGP");
    case "money": return formatMoney(v, (col.currencyKey && typeof row[col.currencyKey] === "string" ? row[col.currencyKey] : "EGP") as string);
    default: return String(v);
  }
}

const numeric = (c: Column) => !!c.type && c.type !== "text" && c.type !== "date";

export function ReportTable({ section }: { section: Section }) {
  const cols = section.columns.filter((c) => c.only !== "excel");
  if (section.rows.length === 0) {
    return <p className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-muted">{section.empty}</p>;
  }
  return (
    <Table className="report-table">
      <THead>
        <tr>{cols.map((c) => <Th key={c.key} align={numeric(c) ? "right" : undefined}>{c.header}</Th>)}</tr>
      </THead>
      <tbody>
        {section.rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => {
              const text = show(c, r);
              const href = c.href?.(r);
              const tone = c.tone?.(r);
              let body: ReactNode = text;
              if (href) body = <Link href={href} className="font-semibold text-primary hover:underline">{text}</Link>;
              const sub = c.subKey ? r[c.subKey] : null;
              return (
                <Td key={c.key} align={numeric(c) ? "right" : undefined}
                  className={[c.mono ? "whitespace-nowrap font-mono text-[13px]" : "", tone ? TONE_CLASS[tone] : "", numeric(c) || c.type === "date" ? "whitespace-nowrap tabular-nums" : ""].join(" ")}>
                  {body}
                  {sub != null && sub !== "" && <span className="block min-w-[10rem] whitespace-normal font-sans text-xs font-normal text-muted">{String(sub)}</span>}
                </Td>
              );
            })}
          </tr>
        ))}
      </tbody>
      {section.totals && (
        <tfoot>
          <tr className="bg-sunken font-semibold">
            {cols.map((c) => {
              const v = section.totals![c.key];
              return (
                <Td key={c.key} align={numeric(c) ? "right" : undefined} className="whitespace-nowrap tabular-nums">
                  {v === undefined || v === null ? "" : show({ ...c, href: undefined }, section.totals!)}
                </Td>
              );
            })}
          </tr>
        </tfoot>
      )}
    </Table>
  );
}
