import Link from "next/link";
import type { ReactNode } from "react";
import { projects } from "@/db/schema";
import { Badge, EmptyState, LinkButton, Panel, StatusBadge } from "@/components/ui";
import { Notice, validityState } from "@/components/procurement/bits";
import { OfferStatusActions } from "@/components/procurement/offer-status-actions";
import { WeightControl } from "@/components/procurement/weight-control";
import { formatMoney, formatNumber } from "@/lib/format";
import type { OfferStatus } from "@/lib/procurement/labels";
import { normalizeWeights, type CellResult } from "@/lib/procurement/scoring";
import { loadComparison } from "@/lib/procurement/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";


type Project = typeof projects.$inferSelect;
const pct = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));

export async function ComparisonTab({ project, tw, me }: { project: Project; tw?: string; me: CurrentUser }) {
  const allow = { edit: can(me.role, "offers.edit"), recommend: can(me.role, "award.recommend") };
  const weights = normalizeWeights(tw);
  const data = await loadComparison(project.id, weights);
  if (!data) return null;
  const { offers, excluded, types, specs, required, evaluation, lineById, fx } = data;
  const cur = project.currency;

  if (offers.length === 0) {
    return (
      <EmptyState title={excluded.length ? "Every offer has been rejected or withdrawn" : "No offers to compare yet"}
        action={<LinkButton href={`/procurement/offers/new?projectId=${project.id}`} variant="primary">Register offer</LinkButton>}>
        Register the quotations you received and record their compliance against the specifications; the comparison builds itself.
      </EmptyState>
    );
  }

  const pendingAwards = new Set((await db.select({ id: approvalRequests.entityId }).from(approvalRequests)
    .where(and(eq(approvalRequests.entity, "AWARD"), eq(approvalRequests.status, "PENDING"), inArray(approvalRequests.entityId, offers.map((o) => o.id))))).map((r) => r.id));
  const missing = Object.entries(fx).filter(([, f]) => f == null).map(([c]) => c);
  const ranked = [...offers].sort((a, b) => (evaluation.offers.get(b.id)?.combinedScore ?? -1) - (evaluation.offers.get(a.id)?.combinedScore ?? -1));
  const top = ranked.find((o) => {
    const s = evaluation.offers.get(o.id);
    return s && s.combinedScore != null && s.nonResponsiveRows === 0;
  });
  const basket = evaluation.rows.reduce((s, r) => {
    const best = r.cells.find((c) => c.isBest && !c.isOptional);
    return best?.lineTotal != null ? s + best.lineTotal : s;
  }, 0);
  const lowestCompliantTotal = Math.min(...offers.map((o) => {
    const s = evaluation.offers.get(o.id);
    return s && s.nonResponsiveRows === 0 && s.total != null && s.rowsQuoted === types.length ? s.total : Infinity;
  }));
  const noSpec = types.filter((t) => !specs.get(t.id)?.items.length);
  const head = (o: (typeof offers)[number]) => o.supplierName;

  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <WeightControl projectId={project.id} technical={weights.technical} />
          <p className="text-xs text-muted">Prices converted to {cur} at the latest stored exchange rates, after discounts.</p>
        </div>
      </Panel>

      {missing.length > 0 && (
        <Notice tone="warn">No exchange rate to {cur} is stored for {missing.join(", ")}. Offers in {missing.length === 1 ? "that currency" : "those currencies"} show no converted price and get no financial score until a rate is added.</Notice>
      )}
      {noSpec.length > 0 && (
        <Notice tone="info">
          {noSpec.map((t) => t.name).join(", ")} {noSpec.length === 1 ? "has" : "have"} no specification parameters, so {noSpec.length === 1 ? "it is" : "they are"} ranked on price only.{" "}
          <Link href={`/procurement/${project.id}?tab=specs`} className="font-semibold underline">Add specifications</Link>
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3">
          <p className="text-sm text-muted">Highest combined score, fully responsive</p>
          {top ? (
            <p className="mt-1 text-lg font-bold">{top.supplierName} <span className="text-primary">{pct(evaluation.offers.get(top.id)?.combinedScore)}</span></p>
          ) : <p className="mt-1 text-lg font-bold">None</p>}
          <p className="text-xs text-muted">
            {top ? `${evaluation.offers.get(top.id)!.rowsQuoted} of ${types.length} items quoted · ` : ""}mean of item scores at {weights.technical}/{weights.financial}
          </p>
        </div>
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3">
          <p className="text-sm text-muted">Lowest fully compliant single award</p>
          <p className="mt-1 text-lg font-bold">{Number.isFinite(lowestCompliantTotal) ? formatMoney(lowestCompliantTotal, cur) : "None"}</p>
          <p className="text-xs text-muted">One supplier quoting every item, no mandatory failures</p>
        </div>
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3">
          <p className="text-sm text-muted">Best value per item (split award)</p>
          <p className="mt-1 text-lg font-bold">{basket ? formatMoney(basket, cur) : "—"}</p>
          <p className="text-xs text-muted">Sum of the highlighted cells</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <caption className="sr-only">Comparison of offers by device type</caption>
          <thead className="bg-sunken text-left text-muted">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-48 border-b border-line bg-sunken px-3 py-2 font-semibold">Device type</th>
              {offers.map((o) => (
                <th key={o.id} scope="col" className="min-w-52 border-b border-l border-line px-3 py-2 align-bottom font-semibold">
                  <Link href={`/procurement/offers/${o.id}`} className="text-ink hover:text-primary">{head(o)}</Link>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs font-normal">{o.reference} · {o.currency} <StatusBadge value={o.status} /></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const row = evaluation.rows.find((r) => r.key === t.id)!;
              const spec = specs.get(t.id);
              return (
                <tr key={t.id} className="align-top">
                  <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left font-normal">
                    <span className="font-semibold">{t.name}</span>
                    <span className="block text-xs text-muted">{t.code}</span>
                    <span className="block text-xs text-muted">
                      {required.has(t.id) ? `Required: ${formatNumber(required.get(t.id))}` : "Quantity per offer"}
                      {spec ? <> · <Link href={`/procurement/specs/${spec.id}`} className="text-primary hover:underline">{spec.items.length} spec items</Link></> : " · no spec"}
                    </span>
                    {row.responsiveCount === 0 && row.cells.length > 0 && <span className="mt-1 block text-xs font-semibold text-danger">No responsive offer</span>}
                  </th>
                  {offers.map((o) => {
                    const c = row.cells.find((x) => x.offerId === o.id);
                    return <MatrixCell key={o.id} cell={c} line={c ? lineById.get(c.lineId) : undefined} currency={cur} required={required.get(t.id)} />;
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="text-[13px]">
            <SummaryRow label={`Total (${cur})`} strong offers={offers} render={(o) => {
              const s = evaluation.offers.get(o.id)!;
              return s.total == null ? <span className="text-warn">Rate missing</span> : formatMoney(s.total, cur);
            }} />
            <SummaryRow label="Items quoted" offers={offers} render={(o) => {
              const s = evaluation.offers.get(o.id)!;
              return <>{s.rowsQuoted} of {types.length}{s.nonResponsiveRows > 0 && <span className="block text-xs font-semibold text-danger">{s.nonResponsiveRows} non-responsive</span>}</>;
            }} />
            <SummaryRow label="Technical score" offers={offers} render={(o) => pct(evaluation.offers.get(o.id)?.technicalScore)} />
            <SummaryRow label="Financial score" offers={offers} render={(o) => pct(evaluation.offers.get(o.id)?.financialScore)} />
            <SummaryRow label={`Combined (${weights.technical}/${weights.financial})`} strong offers={offers} render={(o) => pct(evaluation.offers.get(o.id)?.combinedScore)} />
            <SummaryRow label="Best value on" offers={offers} render={(o) => { const n = evaluation.offers.get(o.id)!.bestRows; return n ? `${n} item${n === 1 ? "" : "s"}` : "—"; }} />
            <SummaryRow label="Delivery · warranty" offers={offers} render={(o) => `${o.deliveryWeeks != null ? `${o.deliveryWeeks} wk` : "—"} · ${o.warrantyMonths != null ? `${o.warrantyMonths} mo` : "—"}`} />
            <SummaryRow label="Validity" offers={offers} render={(o) => {
              const v = validityState(o.validUntil);
              return <span className={v.tone === "danger" ? "text-danger" : v.tone === "warn" ? "text-warn" : undefined}>{v.text}</span>;
            }} />
            <SummaryRow label="Decision" offers={offers} render={(o) => <OfferStatusActions offerId={o.id} status={o.status as OfferStatus} compact exclude={["WITHDRAWN", "UNDER_REVIEW"]} allow={allow} awardPending={pendingAwards.has(o.id)} />} />
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-muted">
        Technical score = weighted share of spec items the offered model complies with (partial counts half). A mandatory item marked not compliant makes
        the line technically non-responsive: it gets no financial or combined score and cannot be best value. Financial score = lowest responsive price ÷
        this price × 100. Highlighted cells are the best combined score per item (ties go to the lower price).
      </p>

      {excluded.length > 0 && (
        <Panel title="Excluded from the evaluation">
          <ul className="divide-y divide-line text-sm">
            {excluded.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Link href={`/procurement/offers/${o.id}`} className="font-semibold text-primary hover:underline">{o.supplierName} · {o.reference}</Link> <StatusBadge value={o.status} /></span>
                <OfferStatusActions offerId={o.id} status={o.status as OfferStatus} compact allow={allow} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function SummaryRow<T extends { id: number }>({ label, offers, render, strong }: {
  label: string; offers: T[]; render: (o: T) => ReactNode; strong?: boolean;
}) {
  return (
    <tr className="bg-sunken/50">
      <th scope="row" className="sticky left-0 z-10 border-b border-line bg-sunken px-3 py-2 text-left font-semibold">{label}</th>
      {offers.map((o) => (
        <td key={o.id} className={`border-b border-l border-line px-3 py-2 align-top ${strong ? "font-bold" : ""}`}>{render(o)}</td>
      ))}
    </tr>
  );
}

function MatrixCell({ cell, line, currency, required }: {
  cell: CellResult | undefined;
  line: { manufacturer: string | null; model: string | null; countryOfOrigin: string | null } | undefined;
  currency: string; required: number | undefined;
}) {
  if (!cell) return <td className="border-b border-l border-line px-3 py-2 text-xs text-faint">Not quoted</td>;
  const t = cell.technical;
  const bg = cell.isBest ? "bg-ok-soft" : !t.responsive ? "bg-danger-soft/60" : "";
  return (
    <td className={`border-b border-l border-line px-3 py-2 ${bg}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted">{[line?.manufacturer, line?.model].filter(Boolean).join(" ") || "Model not stated"}</span>
        {cell.isBest && <Badge tone="ok">Best value</Badge>}
      </div>
      <p className="mt-1 font-semibold tabular-nums">
        {cell.unitPrice == null ? <span className="text-warn">No {cell.currency} rate</span> : formatMoney(cell.unitPrice, currency)}
        <span className="font-normal text-muted"> × {cell.quantity}</span>
      </p>
      {cell.currency !== currency && <p className="text-xs text-muted tabular-nums">{formatMoney(cell.netUnitPrice, cell.currency)} each</p>}
      {cell.lineTotal != null && <p className="text-xs tabular-nums">= {formatMoney(cell.lineTotal, currency)}</p>}
      {required != null && cell.quantity !== required && <p className="text-xs text-warn">Quoted {cell.quantity}, required {required}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {t.itemCount === 0 ? <Badge>No spec</Badge>
          : !t.responsive ? <Badge tone="danger">Fails {t.mandatoryFailed.length} mandatory</Badge>
            : <Badge tone={(t.score ?? 0) >= 90 ? "ok" : (t.score ?? 0) >= 60 ? "warn" : "neutral"}>{t.score!.toFixed(0)}% compliant</Badge>}
        {t.responsive && t.mandatoryUnstated.length > 0 && <Badge tone="warn">{t.mandatoryUnstated.length} unanswered</Badge>}
        {cell.isOptional && <Badge>Optional</Badge>}
        {cell.alternatives > 0 && <Badge tone="info">+{cell.alternatives} alt.</Badge>}
      </div>
      {t.responsive && (
        <p className="mt-1 text-xs text-muted tabular-nums">Fin. {pct(cell.financialScore)} · combined <strong className="text-ink">{pct(cell.combinedScore)}</strong></p>
      )}
    </td>
  );
}
