import { desc } from "drizzle-orm";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { ConfirmButton } from "@/components/ui/confirm";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { CURRENCIES, formatDate, num, todayISO } from "@/lib/format";
import { FX_STALE_DAYS } from "@/lib/fx";
import { loadFx } from "@/lib/server-utils";
import { deleteRateAction, saveRateAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exchange rates" };

const fmtRate = (r: number) => r.toLocaleString("en", { maximumFractionDigits: 4 });

/** Exchange-rate register (audit wave 30, B1): EGP per unit of each currency, by the date it applies from. */
export default async function ExchangeRatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("procurement.view");
  const sp = await searchParams;
  const today = todayISO();
  const [fx, history] = await Promise.all([loadFx(), db.select().from(exchangeRates).orderBy(desc(exchangeRates.effectiveDate), exchangeRates.currency).limit(400)]);
  const latest = fx.latest(today);
  const canEdit = can(me.role, "budgets.edit");
  const foreign = CURRENCIES.filter((c) => c !== "EGP");
  const missing = foreign.filter((c) => !latest.some((l) => l.currency === c));

  return (
    <>
      <PageHeader title="Exchange rates" description="EGP per unit of each currency, by the date it applies from. Offers convert at their opening date, orders at their order date and purchases at their purchase date; estimates and budgets use the latest rate." />
      <Notice sp={sp} />
      <Panel title="Rates in use today" className="mb-5" padded={false}>
        {latest.length === 0 ? <p className="p-4 text-sm text-muted">No rates recorded yet. Amounts in foreign currencies have no EGP value until you add one.</p> : (
          <Table>
            <THead><tr><Th>Currency</Th><Th align="right">EGP per unit</Th><Th>Applies from</Th><Th /></tr></THead>
            <tbody>{latest.map((l) => (
              <tr key={l.currency}>
                <Td><b>{l.currency}</b></Td>
                <Td align="right" className="font-mono">{fmtRate(l.rate)}</Td>
                <Td>{formatDate(l.date)} <span className="text-xs text-muted">{l.ageDays <= 0 ? "today" : `${l.ageDays} days ago`}</span></Td>
                <Td>{l.stale && <Badge tone="warn">Older than {FX_STALE_DAYS} days</Badge>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
        {missing.length > 0 && <p className="border-t border-line px-4 py-2 text-xs text-muted">No rate yet for {missing.join(", ")}.</p>}
      </Panel>
      {canEdit && (
        <Panel title="Record a rate" className="mb-5">
          <ActionForm action={saveRateAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Currency"><NativeSelect name="currency" value="USD" options={foreign.map((c) => ({ value: c, label: c }))} /></Field>
            <Field label="EGP per 1 unit" hint="Central Bank of Egypt rate"><Input name="rate" required inputMode="decimal" placeholder="e.g. 48.65" /></Field>
            <Field label="Applies from"><Input type="date" name="date" required defaultValue={today} max={today} /></Field>
            <div className="flex items-end"><Button>Save rate</Button></div>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">A second rate for the same currency and date replaces the first. Past offers and orders keep the rate of their own date.</p>
        </Panel>
      )}
      <Panel title="History" padded={false}>
        {history.length === 0 ? <EmptyState title="No rates yet">{canEdit ? "Record today's Central Bank rate above." : "Ask Finance to record the rates."}</EmptyState> : (
          <Table>
            <THead><tr><Th>Applies from</Th><Th>Currency</Th><Th align="right">EGP per unit</Th>{canEdit && <Th />}</tr></THead>
            <tbody>{history.map((r) => (
              <tr key={r.id}>
                <Td>{formatDate(r.effectiveDate)}</Td><Td>{r.currency}</Td><Td align="right" className="font-mono">{fmtRate(num(r.rateToEgp))}</Td>
                {canEdit && <Td align="right"><form action={deleteRateAction}><input type="hidden" name="id" value={r.id} />
                  <ConfirmButton confirm={`Remove the ${r.currency} rate of ${formatDate(r.effectiveDate)}? Amounts dated from then use the rate before it.`} className="text-sm text-danger hover:underline">Remove</ConfirmButton></form></Td>}
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
