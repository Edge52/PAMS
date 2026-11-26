/**
 * Analytics › Budget (wave 40): budget used so far and a year-end forecast per budget line. Pure, so the page, the
 * export and the tests agree. All money is in EGP (the page converts with lib/fx before calling).
 *
 * Forecasts (both add what is committed on purchase orders but not invoiced yet):
 * - straight line: spent so far ÷ months gone × 12, plus committed.
 * - seasonal (when last year has invoices): spent so far ÷ the share of last year's spending that fell in the same
 *   months, plus committed. It needs at least `MIN_SEASON_SHARE` of last year's spend in those months.
 * A line forecast over 100 % of its budget is flagged "over"; under 70 % is flagged "under" (money that may be lost
 * or could move to another line).
 */

export const OVER_AT = 1;
export const UNDER_AT = 0.7;
/** The seasonal forecast is used only when last year's spend in the months gone is at least this share of its year. */
export const MIN_SEASON_SHARE = 0.05;

const DAY = 86_400_000;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Month of the budget year a date falls in: 0 = the first month (July with a July start), 11 = the last. */
export function fiscalMonthIndex(date: string, startMonth: number): number {
  const m = Number(date.slice(5, 7));
  return (m - startMonth + 12) % 12;
}

/**
 * Months of the budget year gone by `today` (fractional, 0–12). Each month counts by its own length, so 15 August
 * in a July year is 1 + 15/31.
 */
export function monthsGone(fyStart: string, fyEnd: string, today: string): number {
  if (today < fyStart) return 0;
  if (today > fyEnd) return 12;
  const y0 = Number(fyStart.slice(0, 4)), m0 = Number(fyStart.slice(5, 7)) - 1;
  let gone = 0;
  for (let i = 0; i < 12; i++) {
    const a = Date.UTC(y0, m0 + i, 1), b = Date.UTC(y0, m0 + i + 1, 1);
    const now = t(today) + DAY; // the whole of today counts
    if (now >= b) gone += 1;
    else { if (now > a) gone += (now - a) / (b - a); break; }
  }
  return Math.min(12, gone);
}

/** Last year's monthly spending as shares of its total (12 numbers adding to 1), or null when there was none. */
export function seasonShape(monthly: number[] | null | undefined): number[] | null {
  if (!monthly || monthly.length !== 12) return null;
  const clean = monthly.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((s, v) => s + v, 0);
  return total > 0 ? clean.map((v) => v / total) : null;
}

/** Share of a year's spending that falls in the first `gone` months (fractional months count pro rata). */
export function shareGone(shape: number[], gone: number): number {
  let s = 0;
  for (let i = 0; i < 12; i++) {
    if (gone >= i + 1) s += shape[i];
    else { if (gone > i) s += shape[i] * (gone - i); break; }
  }
  return s;
}

export type BudgetLineIn = {
  id: number; name: string; kind: string; facilityId: number;
  /** EGP. */
  amount: number; committed: number; spent: number;
  /** Last year's monthly spend (EGP, budget-year months), for the seasonal forecast. */
  lastYearMonthly?: number[] | null;
};

export type Flag = "over" | "under" | "ok" | null;

export type BudgetLineOut = BudgetLineIn & {
  usedPct: number | null;
  straight: number | null;
  seasonal: number | null;
  /** The forecast shown: seasonal when there is one and it was asked for, else straight line. */
  forecast: number | null;
  method: "straight" | "seasonal" | null;
  forecastPct: number | null;
  flag: Flag;
};

/** Straight-line year-end: spent ÷ months gone × 12, plus committed. Null before the year starts. */
export function straightForecast(spent: number, committed: number, gone: number): number | null {
  if (!(gone > 0)) return null;
  return (spent / gone) * 12 + committed;
}

/** Seasonal year-end: spent ÷ last year's share for the months gone, plus committed. Null without enough history. */
export function seasonalForecast(spent: number, committed: number, gone: number, shape: number[] | null): number | null {
  if (!shape || !(gone > 0)) return null;
  const share = shareGone(shape, gone);
  if (share < MIN_SEASON_SHARE) return null;
  return spent / Math.min(1, share) + committed;
}

export function flagOf(forecastPct: number | null, gone: number): Flag {
  if (forecastPct == null) return null;
  if (forecastPct > OVER_AT) return "over";
  // An "under" flag in the first month says little: wait for one month of spending.
  if (forecastPct < UNDER_AT && gone >= 1) return "under";
  return "ok";
}

/** Every line with its use, forecasts and flag. `prefer` = "seasonal" uses that forecast where it exists. */
export function budgetForecast(lines: BudgetLineIn[], gone: number, prefer: "straight" | "seasonal" = "straight"): BudgetLineOut[] {
  return lines.map((l) => {
    const used = l.committed + l.spent;
    const straight = straightForecast(l.spent, l.committed, gone);
    const seasonal = seasonalForecast(l.spent, l.committed, gone, seasonShape(l.lastYearMonthly));
    const useSeasonal = prefer === "seasonal" && seasonal != null;
    const forecast = useSeasonal ? seasonal : straight;
    // Nothing ever sits below what is already committed or spent.
    const f = forecast == null ? null : Math.max(forecast, used);
    const forecastPct = f != null && l.amount > 0 ? f / l.amount : null;
    return {
      ...l, usedPct: l.amount > 0 ? used / l.amount : null, straight, seasonal, forecast: f,
      method: f == null ? null : useSeasonal ? "seasonal" : "straight", forecastPct, flag: flagOf(forecastPct, gone),
    };
  });
}

export type BudgetTotals = { amount: number; committed: number; spent: number; forecast: number; usedPct: number | null; forecastPct: number | null; over: number; under: number; lines: number };

export function budgetTotals(rows: BudgetLineOut[]): BudgetTotals {
  const s = rows.reduce((a, r) => ({ amount: a.amount + r.amount, committed: a.committed + r.committed, spent: a.spent + r.spent, forecast: a.forecast + (r.forecast ?? r.committed + r.spent) }),
    { amount: 0, committed: 0, spent: 0, forecast: 0 });
  return {
    ...s, usedPct: s.amount > 0 ? (s.committed + s.spent) / s.amount : null, forecastPct: s.amount > 0 ? s.forecast / s.amount : null,
    over: rows.filter((r) => r.flag === "over").length, under: rows.filter((r) => r.flag === "under").length, lines: rows.length,
  };
}

/** Add one invoice amount to a 12-month series by its date. */
export function addToMonth(series: number[], date: string, amount: number, startMonth: number): void {
  series[fiscalMonthIndex(date, startMonth)] += amount;
}
