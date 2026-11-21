/**
 * The date a tender's prices are converted at (audit wave 30, B2). Pure.
 *
 * Offers in different currencies are compared at the exchange rate of the day prices were opened, so a closed
 * tender's ranking and scores never change because the rate moved afterwards:
 *   1. two-envelope tender: the day the financial envelopes were opened;
 *   2. otherwise the day the envelopes were opened;
 *   3. otherwise the RFQ's closing date, once it has passed;
 *   4. otherwise (still open) today — the ranking is provisional until opening.
 */
export type PriceDateInput = {
  twoEnvelope: boolean; technicalOpenedAt: Date | null; financialOpenedAt: Date | null;
  rfqClosingDate?: string | null;
};

export function tenderPriceDate(p: PriceDateInput, today: string, toLocalDate: (d: Date) => string): { date: string; fixed: boolean; basis: string } {
  if (p.twoEnvelope && p.financialOpenedAt) return { date: toLocalDate(p.financialOpenedAt), fixed: true, basis: "financial envelopes opened" };
  if (!p.twoEnvelope && p.technicalOpenedAt) return { date: toLocalDate(p.technicalOpenedAt), fixed: true, basis: "envelopes opened" };
  if (p.rfqClosingDate && p.rfqClosingDate <= today) return { date: p.rfqClosingDate, fixed: true, basis: "RFQ closing date" };
  return { date: today, fixed: false, basis: "today (tender still open)" };
}
