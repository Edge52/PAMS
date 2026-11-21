/**
 * Exchange rates by date (audit wave 30: B1, B2, DL-05, DL-18). Pure — safe for tests, pages and scripts.
 *
 * Rates are EGP per 1 unit of a currency, entered in the exchange-rate register (Finance › Exchange rates), each with
 * the date it applies from (normally the Central Bank of Egypt rate of that day). An amount is converted at the rate
 * in force on the date that fixes it: an offer on its opening date, an order on its order date, a purchase on its
 * purchase date. Today's rate is only for amounts that are not fixed yet (estimates, budgets left).
 */
export type FxRow = { currency: string; rateToEgp: number; effectiveDate: string };
export type FxHit = { rate: number; date: string; /** true when the date is before the first stored rate (the first one is used). */ early: boolean };

/** Rates older than this many days are flagged on the register and wherever "today's rate" is used. */
export const FX_STALE_DAYS = 31;

export class FxTable {
  private byCurrency = new Map<string, FxRow[]>();
  constructor(rows: FxRow[]) {
    for (const r of rows) {
      const c = r.currency.toUpperCase();
      if (c === "EGP" || !(r.rateToEgp > 0)) continue;
      (this.byCurrency.get(c) ?? this.byCurrency.set(c, []).get(c)!).push({ ...r, currency: c });
    }
    for (const list of this.byCurrency.values()) list.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }

  /**
   * The rate in force on `date` (the latest rate dated on or before it). A date before the first stored rate gets the
   * first rate, marked `early`, rather than nothing: old purchases still get an EGP value. Null when the currency has
   * no rate at all.
   */
  rateOn(currency: string | null | undefined, date: string): FxHit | null {
    const c = (currency || "EGP").toUpperCase();
    if (c === "EGP") return { rate: 1, date, early: false };
    const list = this.byCurrency.get(c);
    if (!list?.length) return null;
    let hit: FxRow | null = null;
    for (const r of list) { if (r.effectiveDate <= date) hit = r; else break; }
    return hit ? { rate: hit.rateToEgp, date: hit.effectiveDate, early: false } : { rate: list[0].rateToEgp, date: list[0].effectiveDate, early: true };
  }

  /** EGP value of an amount on a date; null when the currency has no rate. */
  toEgp(amount: number, currency: string | null | undefined, date: string): number | null {
    const h = this.rateOn(currency, date);
    return h ? Math.round(amount * h.rate * 100) / 100 : null;
  }

  /** Amount converted between two currencies through EGP, both at the rate of `date`. */
  convert(amount: number, from: string, to: string, date: string): number | null {
    if (from === to) return amount;
    const a = this.rateOn(from, date), b = this.rateOn(to, date);
    return a && b ? (amount * a.rate) / b.rate : null;
  }

  currencies(): string[] { return [...this.byCurrency.keys()].sort(); }

  /** Latest rate per currency, with its age in days on `today` and whether it is stale. */
  latest(today: string): { currency: string; rate: number; date: string; ageDays: number; stale: boolean }[] {
    return this.currencies().map((c) => {
      const list = this.byCurrency.get(c)!; const r = list[list.length - 1];
      const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(r.effectiveDate + "T00:00:00Z")) / 864e5);
      return { currency: c, rate: r.rateToEgp, date: r.effectiveDate, ageDays, stale: ageDays > FX_STALE_DAYS };
    });
  }
}

/** Validate a rate typed into the register. */
export function parseRateInput(input: { currency: string; rate: string; date: string }, today: string):
  { ok: true; currency: string; rate: number; date: string } | { ok: false; error: string; field: "currency" | "rate" | "date" } {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, field: "currency", error: "Choose the currency." };
  if (currency === "EGP") return { ok: false, field: "currency", error: "EGP is the base currency: its rate is always 1." };
  const rate = Number(input.rate.replace(/,/g, "").trim());
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1e6) return { ok: false, field: "rate", error: "Enter how many EGP one unit is worth, e.g. 48.65." };
  const date = input.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { ok: false, field: "date", error: "Enter the date the rate applies from." };
  if (date > today) return { ok: false, field: "date", error: "The date can't be in the future." };
  return { ok: true, currency, rate: Math.round(rate * 1e6) / 1e6, date };
}
