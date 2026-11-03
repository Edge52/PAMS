/**
 * Total cost of ownership (wave 9, D5): each offer's price plus service after the warranty, running costs and the
 * downtime its uptime guarantee allows, over 5 or 10 years — next to what similar models have cost us to maintain.
 */
import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, maintenanceEvents, workOrders } from "@/db/schema";
import { Panel } from "@/components/ui";
import { formatMoney, num } from "@/lib/format";
import { tco } from "@/lib/assets/planning";
import { fxFactors, type ComparisonData } from "@/lib/procurement/server";

type Data = NonNullable<ComparisonData>;

export async function TcoPanel({ data, projectId, years, downtimeCostPerDay }: { data: Data; projectId: number; years: 5 | 10; downtimeCostPerDay: number | null }) {
  const { offers, evaluation, lines, project } = data;
  const cur = project.currency;
  const fx = await fxFactors(offers.map((o) => o.currency), cur);
  const amt = (v: string | null, c: string) => (v == null ? null : fx[c] != null ? num(v) * fx[c]! : null);
  const rows = offers.map((o) => {
    const capex = evaluation.offers.get(o.id)?.total ?? null;
    return { o, capex, t: capex == null ? null : tco({ capex, years, warrantyMonths: o.warrantyMonths, serviceAnnual: amt(o.tcoServiceAnnual, o.currency), consumablesAnnual: amt(o.tcoConsumablesAnnual, o.currency),
      energyAnnual: amt(o.tcoEnergyAnnual, o.currency), otherAnnual: amt(o.tcoOtherAnnual, o.currency), uptimePct: o.tcoUptimePct, downtimeCostPerDay }) };
  });
  // Our own history: maintenance and repair spend a year per unit of the same make and model, last three years.
  const models = [...new Set(lines.filter((l) => l.manufacturer && l.model).map((l) => `${l.manufacturer!.trim().toLowerCase()}|${l.model!.trim().toLowerCase()}`))];
  const history = new Map<string, { units: number; perYear: number }>();
  if (models.length) {
    const units = await db.select({ id: assets.id, key: sql<string>`lower(trim(${assets.manufacturer})) || '|' || lower(trim(${assets.model}))` }).from(assets)
      .where(and(sql`${assets.status} <> 'DISPOSED'`, inArray(sql`lower(trim(${assets.manufacturer})) || '|' || lower(trim(${assets.model}))`, models)));
    if (units.length) {
      const ids = units.map((u) => u.id);
      const [me, wo] = await Promise.all([
        db.select({ assetId: maintenanceEvents.assetId, currency: maintenanceEvents.currency, total: sql<string>`sum(${maintenanceEvents.cost})` }).from(maintenanceEvents)
          .where(and(inArray(maintenanceEvents.assetId, ids), eq(maintenanceEvents.status, "COMPLETED"), sql`${maintenanceEvents.completedDate} >= current_date - interval '3 years'`)).groupBy(maintenanceEvents.assetId, maintenanceEvents.currency),
        db.select({ assetId: workOrders.assetId, currency: workOrders.currency, total: sql<string>`sum(${workOrders.cost})` }).from(workOrders)
          .where(and(inArray(workOrders.assetId, ids), sql`${workOrders.cost} is not null and ${workOrders.reportedAt} >= now() - interval '3 years'`)).groupBy(workOrders.assetId, workOrders.currency),
      ]);
      const hfx = await fxFactors([...me, ...wo].map((x) => x.currency ?? cur), cur);
      for (const m of models) {
        const mine = new Set(units.filter((u) => u.key === m).map((u) => u.id));
        if (!mine.size) continue;
        const spend = [...me, ...wo].filter((x) => mine.has(x.assetId)).reduce((s, x) => s + num(x.total) * (hfx[x.currency ?? cur] ?? 0), 0);
        history.set(m, { units: mine.size, perYear: spend / 3 / mine.size });
      }
    }
  }
  const offerHistory = (offerId: number) => [...new Set(lines.filter((l) => l.offerId === offerId && l.manufacturer && l.model).map((l) => `${l.manufacturer!.trim().toLowerCase()}|${l.model!.trim().toLowerCase()}`))]
    .map((k) => ({ k, h: history.get(k), name: lines.find((l) => `${l.manufacturer!.trim().toLowerCase()}|${l.model!.trim().toLowerCase()}` === k)!.model! })).filter((x) => x.h);
  const best = Math.min(...rows.map((r) => r.t?.total ?? Infinity));
  const q = (y: number, d: number | null) => `/procurement/${projectId}?tab=comparison&tcoYears=${y}${d != null ? `&tcoDown=${d}` : ""}`;
  const money = (n: number | null) => (n == null ? "—" : formatMoney(n, cur, { compact: true }));

  return (
    <Panel title={`Total cost of ownership over ${years} years (${cur})`}
      actions={<span className="flex gap-3 text-sm">{[5, 10].map((y) => <Link key={y} href={q(y, downtimeCostPerDay)} className={y === years ? "font-semibold text-primary" : "text-muted hover:underline"}>{y} years</Link>)}</span>}>
      <form className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="tab" value="comparison" /><input type="hidden" name="tcoYears" value={years} />
        <label className="flex flex-col"><span className="font-semibold">Cost of a day out of service ({cur})</span>
          <input name="tcoDown" type="number" min={0} defaultValue={downtimeCostPerDay ?? ""} placeholder="e.g. lost exams × tariff" className="w-48 rounded border border-line bg-surface px-2 py-1" /></label>
        <button className="rounded border border-line px-3 py-1">Apply</button>
      </form>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]">
        <thead className="text-left text-muted"><tr><th className="py-1">Offer</th><th className="text-right">Price</th><th className="text-right">Service after warranty</th><th className="text-right">Running</th><th className="text-right">Downtime</th><th className="text-right">Total</th><th>Our history, same model</th></tr></thead>
        <tbody>{rows.map(({ o, capex, t }) => (
          <tr key={o.id} className="border-t border-line align-top">
            <td className="py-1.5"><Link href={`/procurement/offers/${o.id}`} className="font-semibold text-primary hover:underline">{o.supplierName}</Link>
              {t?.missing.length ? <span className="block text-xs text-warn">Not stated: {t.missing.join(", ")}</span> : null}</td>
            <td className="text-right">{money(capex)}</td>
            <td className="text-right">{t ? money(t.service) : "—"}{t && t.serviceYears > 0 ? <span className="block text-xs text-muted">{t.serviceYears.toFixed(1)} years</span> : null}</td>
            <td className="text-right">{t ? money(t.running) : "—"}</td>
            <td className="text-right">{t?.downtime != null ? money(t.downtime) : <span className="text-muted">{o.tcoUptimePct == null ? "no guarantee" : "set day cost"}</span>}</td>
            <td className={`text-right font-semibold ${t && t.total === best ? "text-ok" : ""}`}>{t ? money(t.total) : <span className="text-warn">Rate missing</span>}</td>
            <td className="text-xs">{offerHistory(o.id).map(({ k, h, name }) => <span key={k} className="block">{name}: {h!.perYear > 0 ? `${money(h!.perYear)} a year per unit` : "no costs recorded"} ({h!.units} unit{h!.units === 1 ? "" : "s"})</span>)}{offerHistory(o.id).length === 0 && <span className="text-muted">none registered</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="mt-2 text-xs text-muted">Running costs and uptime come from each offer&apos;s commercial terms (edit the offer to add them); downtime is the days a year the guarantee allows × the day cost. Our history is what similar registered units cost to maintain and repair a year over the last three years.</p>
    </Panel>
  );
}
