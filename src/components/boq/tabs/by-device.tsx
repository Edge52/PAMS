import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { formatMoney, formatNumber } from "@/lib/format";
import type { BoqWorkspace } from "@/lib/boq/queries";
import { buildPivot } from "@/lib/boq/pivot";

export function ByDeviceTab({ ws }: { ws: BoqWorkspace }) {
  const { rows, columns } = buildPivot(ws);
  const cur = ws.boq.currency;
  if (rows.length === 0) {
    return <EmptyState title="Nothing to procure yet">Regenerate from the standard or add lines by hand to see the procurement view.</EmptyState>;
  }
  const categories = [...new Set(rows.map((r) => r.categoryCode))];
  return (
    <>
      <p className="mb-3 text-sm text-muted">Total quantity of each device type across departments — the list you send to suppliers.</p>
      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
        <table className="w-full border-collapse text-[14px]">
          <thead className="bg-sunken text-left text-[13px] text-muted">
            <tr>
              <th className="sticky left-0 z-10 border-b border-line bg-sunken px-3 py-2 font-semibold">Device type</th>
              {columns.map((c) => (
                <th key={c.id} className="border-b border-line px-2 py-2 text-right font-semibold" title={c.typeName}>
                  <span className="block max-w-28 truncate">{c.label}</span>
                </th>
              ))}
              <th className="border-b border-line px-3 py-2 text-right font-semibold">Total qty</th>
              <th className="border-b border-line px-3 py-2 text-right font-semibold">Unit estimate</th>
              <th className="border-b border-line px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const catRows = rows.filter((r) => r.categoryCode === cat);
              return [
                <tr key={`cat-${cat}`} className="bg-primary-soft/50">
                  <td colSpan={columns.length + 4} className="sticky left-0 border-b border-line px-3 py-1.5 text-[13px] font-semibold text-primary-strong">
                    {catRows[0].categoryName}
                    <span className="ml-2 font-normal text-muted">{formatMoney(ws.totals.byCategory.get(cat) ?? 0, cur)}</span>
                  </td>
                </tr>,
                ...catRows.map((r) => (
                  <tr key={r.deviceTypeId} className="hover:bg-sunken/50">
                    <td className="sticky left-0 border-b border-line bg-surface px-3 py-2">
                      <Link href={`/catalogue/${r.deviceCode}`} className="font-semibold hover:underline">{r.deviceName}</Link>
                      <span className="block font-mono text-xs text-muted">{r.deviceCode}</span>
                    </td>
                    {columns.map((c) => {
                      const q = r.byDept.get(c.id);
                      return <td key={c.id} className="border-b border-line px-2 py-2 text-right">{q ? formatNumber(q) : <span className="text-faint">·</span>}</td>;
                    })}
                    <td className="border-b border-line px-3 py-2 text-right font-semibold">{formatNumber(r.qty)}</td>
                    <td className="border-b border-line px-3 py-2 text-right whitespace-nowrap">
                      {r.unitPrices.size === 0 ? <span className="text-warn">No price</span>
                        : r.unitPrices.size === 1 ? formatMoney([...r.unitPrices][0], cur)
                          : <span title="Different unit prices across departments">{formatMoney(r.qty ? r.amount / r.qty : 0, cur)} avg</span>}
                    </td>
                    <td className="border-b border-line px-3 py-2 text-right font-semibold whitespace-nowrap">{formatMoney(r.amount, cur)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="bg-sunken font-semibold">
              <td className="sticky left-0 bg-sunken px-3 py-2">Subtotal</td>
              {columns.map((c) => (
                <td key={c.id} className="px-2 py-2 text-right">{formatNumber(rows.reduce((s, r) => s + (r.byDept.get(c.id) ?? 0), 0))}</td>
              ))}
              <td className="px-3 py-2 text-right">{formatNumber(rows.reduce((s, r) => s + r.qty, 0))}</td>
              <td />
              <td className="px-3 py-2 text-right whitespace-nowrap">{formatMoney(ws.totals.subtotal, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
