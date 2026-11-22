/**
 * Award and regret letters (wave 37, audit "missing features" 2). Pure: ranking of the offers and the reason a
 * bidder was not awarded, from the evaluation (scoring.ts). Law 182/2018 art. 39: every bidder is told the result,
 * with the reasons, and has a set number of days to complain.
 */

export type RankInput = { offerId: number; combinedScore: number | null };

/**
 * Rank of each ranked offer, 1 = best combined score. Equal scores share a rank (1, 2, 2, 4). Offers without a
 * combined score (non-responsive, partial bid, sealed) have no rank.
 */
export function rankOffers(list: RankInput[]): Map<number, number> {
  const scored = list.filter((o) => o.combinedScore != null && Number.isFinite(o.combinedScore))
    .sort((a, b) => (b.combinedScore as number) - (a.combinedScore as number) || a.offerId - b.offerId);
  const out = new Map<number, number>();
  scored.forEach((o, i) => {
    const prev = scored[i - 1];
    out.set(o.offerId, prev && Math.abs((prev.combinedScore as number) - (o.combinedScore as number)) < 1e-6 ? out.get(prev.offerId)! : i + 1);
  });
  return out;
}

export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export type RegretInput = {
  status: string;
  /** Mandatory items the offer failed, e.g. "Field strength (MRI 1.5T)". */
  mandatoryFailures: string[];
  /** From the evaluation summary; null when the offer isn't in the evaluation (rejected or withdrawn). */
  notRanked: string | null;
  nonResponsiveRows: number;
  rank: number | null;
  rankedCount: number;
  weights: { technical: number; financial: number };
  winner: string;
};

/** The reason given in a regret letter, in plain words. */
export function regretReason(i: RegretInput): string {
  const list = (xs: string[]) => (xs.length <= 3 ? xs.join("; ") : `${xs.slice(0, 3).join("; ")} and ${xs.length - 3} more`);
  if (i.mandatoryFailures.length) {
    return `Your offer did not meet ${i.mandatoryFailures.length === 1 ? "a mandatory requirement" : "mandatory requirements"} of the technical specifications (${list(i.mandatoryFailures)}), so it was found technically non-responsive.`;
  }
  if (i.status === "REJECTED") return "Your offer was rejected by the committee in its evaluation.";
  if (i.nonResponsiveRows > 0) return "Part of your offer did not meet the mandatory technical requirements.";
  if (i.notRanked) return "Your offer did not quote every item required by the tender, so it could not be ranked against complete offers.";
  if (i.rank != null) {
    return `Your offer was technically acceptable and ranked ${ordinal(i.rank)} of ${i.rankedCount} on the combined technical (${i.weights.technical} %) and financial (${i.weights.financial} %) score. The award went to the offer with the highest combined score, from ${i.winner}.`;
  }
  return `The committee recommended the award to ${i.winner}, whose offer gave the best value under the tender's evaluation criteria.`;
}

/** Which letter an offer gets once its tender is awarded: none for withdrawn offers. */
export function letterFor(offer: { id: number; status: string }, awardedOfferId: number | null): "award" | "regret" | null {
  if (awardedOfferId == null) return null;
  if (offer.id === awardedOfferId) return offer.status === "AWARDED" ? "award" : null;
  return offer.status === "WITHDRAWN" ? null : "regret";
}
