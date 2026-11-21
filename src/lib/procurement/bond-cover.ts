/**
 * Held bonds against the amount required (audit DL-07). Bonds can be in another currency than the offer or order,
 * so each amount is converted before adding up and comparing. Pure: the caller passes the factors.
 */

export type HeldBond = { amount: number; currency: string };

/**
 * `factors[c]` turns one unit of currency c into `currency` (null/undefined = no rate).
 * `short` is null when it can't be checked: a bond's currency has no rate, or nothing is required yet.
 */
export function bondCover(held: HeldBond[], required: number | null, currency: string, factors: Record<string, number | null | undefined>) {
  let total = 0;
  const missing = new Set<string>();
  for (const b of held) {
    const f = b.currency === currency ? 1 : factors[b.currency];
    if (f == null || !Number.isFinite(f)) { missing.add(b.currency); continue; }
    total += b.amount * f;
  }
  const checkable = required != null && missing.size === 0;
  return {
    /** Held amount in `currency` (bonds without a rate left out). */
    total: Math.round(total * 100) / 100,
    missing: [...missing].sort(),
    converted: held.some((b) => b.currency !== currency),
    short: checkable ? total + 0.005 < required : null,
  };
}
