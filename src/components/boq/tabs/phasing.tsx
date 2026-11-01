import { Badge, Button, Panel, Table, Td, Th, THead } from "@/components/ui";
import { savePhasing } from "@/app/boq/actions";
import { ADVANCE_SHARE, MAX_PHASES } from "@/lib/boq/phasing";
import type { BoqPlanning } from "@/lib/boq/planning-server";
import type { BoqWorkspace } from "@/lib/boq/queries";
import { formatMoney, formatNumber } from "@/lib/format";

/** Phasing and cash flow, and the cost of owning the equipment over 5 and 10 years. */
export function PhasingTab({ ws, planning, locked }: { ws: BoqWorkspace; planning: BoqPlanning; locked: boolean }) {
  const { boq, totals } = ws;
  const money = (n: number) => formatMoney(n, boq.currency, { compact: Math.abs(n) >= 1e6 });
  const { flow, tco5, tco10, phaseMonths } = planning;
  const peak = Math.max(1, ...flow.rows.map((r) => r.total));
  const phaseLabel = (p: number) => (p === 1 ? "Phase 1 (opening)" : `Phase ${p} (+${phaseMonths[p - 1]} months)`);

  return (
    <div className="space-y-5">
      <Panel title="Opening phases">
        <form action={savePhasing}>
          <input type="hidden" name="boqId" value={boq.id} />
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">Phase 1 opens on
              <input type="date" name="openingDate" defaultValue={boq.openingDate ?? ""} disabled={locked}
                className="mt-1 block rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5" />
            </label>
            {[2, 3, 4].map((p) => (
              <label key={p} className="text-sm">Phase {p}, months later
                <input type="number" name={`phase${p}`} min={0} max={120} defaultValue={phaseMonths[p - 1]} disabled={locked}
                  className="mt-1 block w-28 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5" />
              </label>
            ))}
          </div>
          {!planning.openingSet && <p className="mt-2 text-xs text-muted">No opening date yet: the cash flow below counts from today.</p>}
          <Table className="mt-4">
            <THead><tr><Th>Department</Th><Th align="right">Beds</Th><Th align="right">Equipment</Th><Th>Opens in</Th></tr></THead>
            <tbody>
              {ws.depts.map((d) => (
                <tr key={d.id}>
                  <Td>{d.label}{d.realName ? <span className="text-muted"> · {d.realName}</span> : null}</Td>
                  <Td align="right">{formatNumber(d.beds * Math.max(1, d.instances))}</Td>
                  <Td align="right">{money(totals.byDepartment.get(d.id) ?? 0)}</Td>
                  <Td>
                    <select name={`phase_${d.id}`} defaultValue={d.phase} disabled={locked} aria-label={`Phase for ${d.label}`}
                      className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1">
                      {Array.from({ length: MAX_PHASES }, (_, i) => i + 1).map((p) => <option key={p} value={p}>{phaseLabel(p)}</option>)}
                    </select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!locked && <div className="mt-3"><Button variant="primary">Save phasing</Button></div>}
        </form>
      </Panel>

      <Panel title="Cash flow by quarter" actions={<span className="text-xs text-muted">{Math.round(ADVANCE_SHARE * 100)} % with the order, the rest on delivery a month before opening</span>}>
        {flow.rows.length === 0 ? <p className="text-sm text-muted">No priced lines yet.</p> : (
          <>
            <ul className="mb-3 flex flex-wrap gap-2 text-sm">
              {flow.phases.map((p) => <li key={p.phase} className="rounded-[var(--radius-panel)] border border-line px-3 py-1.5">Phase {p.phase}: <strong>{money(p.amount)}</strong>, opens {p.opens}</li>)}
            </ul>
            <p className="mb-3 text-xs text-muted">Orders start in {flow.firstOrder} (big imaging is ordered 8–10 months ahead, most equipment 3–6). Amounts before contingency.</p>
            <Table>
              <THead><tr><Th>Quarter</Th><Th align="right">Advance payments</Th><Th align="right">On delivery</Th><Th align="right">Total</Th><Th className="w-1/3">Spending</Th><Th align="right">Cumulative</Th></tr></THead>
              <tbody>
                {flow.rows.map((r) => (
                  <tr key={r.quarter}>
                    <Td className="whitespace-nowrap font-semibold">{r.quarter}</Td>
                    <Td align="right">{money(r.advance)}</Td>
                    <Td align="right">{money(r.delivery)}</Td>
                    <Td align="right" className="font-semibold">{money(r.total)}</Td>
                    <Td><span className="block h-2.5 rounded-sm bg-primary" style={{ width: `${Math.max(2, (r.total / peak) * 100)}%` }} aria-hidden /></Td>
                    <Td align="right">{money(r.cumulative)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Panel>

      <Panel title="Cost of ownership" actions={<span className="text-xs text-muted">Draft yearly rates per device group; replace with your contract figures</span>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {[tco5, tco10].map((t) => (
            <div key={t.years} className="rounded-[var(--radius-panel)] border border-line px-4 py-3">
              <p className="text-sm text-muted">{t.years} years</p>
              <p className="mt-1 text-2xl font-bold">{money(t.total)}</p>
              <p className="text-xs text-muted">Purchase {money(t.purchase)} · running {money(t.running)}{t.replacements ? ` · replacements ${money(t.replacements)}` : ""}</p>
              <p className="mt-1 text-xs">{formatNumber(t.total / Math.max(1, t.purchase), 1)} × the purchase price</p>
            </div>
          ))}
        </div>
        <Table className="mt-4">
          <THead><tr><Th>Device group</Th><Th align="right">Purchase</Th><Th align="right">Running, 10 years</Th><Th align="right">Replacements</Th><Th align="right">10-year total</Th></tr></THead>
          <tbody>
            {tco10.byGroup.map((g) => (
              <tr key={g.group}>
                <Td>{g.group}</Td><Td align="right">{money(g.purchase)}</Td><Td align="right">{money(g.running)}</Td>
                <Td align="right">{g.replacements ? money(g.replacements) : "—"}</Td><Td align="right" className="font-semibold">{money(g.total)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {tco10.runningHeavy.length > 0 && (
          <>
            <p className="mt-4 text-sm font-semibold">Costs more to run than to buy over 10 years</p>
            <p className="text-xs text-muted">Weigh running costs (service contracts, consumables) in the tender evaluation for these, not only the price.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {tco10.runningHeavy.map((r) => <li key={r.name}><Badge tone="warn">{r.name}: {money(r.running)} running vs {money(r.purchase)}</Badge></li>)}
            </ul>
          </>
        )}
        <p className="mt-3 text-xs text-muted">Service life comes from the device catalogue where it is set; replacements are counted when a life ends inside the period.</p>
      </Panel>
    </div>
  );
}
