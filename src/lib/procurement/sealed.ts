/**
 * Two-envelope tenders (wave 10; audit wave 30, S1): until the financial envelopes are opened, no page shows an
 * offer's value, prices or financial score. Pure, so pages and tests share one rule.
 */

export type EnvelopeState = { twoEnvelope: boolean; financialOpenedAt: Date | string | null };

/** True while the prices of this tender's offers must stay hidden. */
export function pricesSealed(p: EnvelopeState | null | undefined): boolean {
  return !!p && p.twoEnvelope && !p.financialOpenedAt;
}

/** What a page shows in place of a sealed value. */
export const SEALED = "Sealed";

export type SealedRow<T> = Omit<T, "financialScore"> & { total: number | null; financialScore: number | null; sealed: boolean };

/**
 * Offer list rows with their value, or sealed: `totals` comes from `offerTotals` (which leaves sealed offers out),
 * `sealedIds` from `sealedOfferIds`. A sealed row has no total and no financial score.
 */
export function sealOfferRows<T extends { id: number; financialScore: number | null }>(rows: T[], totals: Map<number, number>, sealedIds: Set<number>): SealedRow<T>[] {
  return rows.map((r) => {
    const sealed = sealedIds.has(r.id);
    return { ...r, sealed, total: sealed ? null : totals.get(r.id) ?? 0, financialScore: sealed ? null : r.financialScore };
  });
}
