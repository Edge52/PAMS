import { describe, expect, it } from "vitest";
import { letterFor, ordinal, rankOffers, regretReason } from "./award-letters";

const base = { status: "UNDER_REVIEW", mandatoryFailures: [], notRanked: null, nonResponsiveRows: 0, rank: 2, rankedCount: 3, weights: { technical: 70, financial: 30 }, winner: "Nile Medical" };

describe("rankOffers", () => {
  it("ranks by combined score, ties share a rank, unscored offers get none", () => {
    const r = rankOffers([{ offerId: 1, combinedScore: 80 }, { offerId: 2, combinedScore: 90 }, { offerId: 3, combinedScore: 80 }, { offerId: 4, combinedScore: 70 }, { offerId: 5, combinedScore: null }]);
    expect([...r.entries()]).toEqual([[2, 1], [1, 2], [3, 2], [4, 4]]);
    expect(r.has(5)).toBe(false);
  });
});

describe("ordinal", () => {
  it("writes English ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });
});

describe("regretReason", () => {
  it("names mandatory failures first", () => {
    expect(regretReason({ ...base, mandatoryFailures: ["Battery (Ventilator)"] })).toMatch(/did not meet a mandatory requirement .*Battery \(Ventilator\)/);
    expect(regretReason({ ...base, mandatoryFailures: ["a", "b", "c", "d", "e"] })).toContain("a; b; c and 2 more");
  });
  it("explains rejection, partial bids and ranking", () => {
    expect(regretReason({ ...base, status: "REJECTED", rank: null })).toMatch(/rejected by the committee/);
    expect(regretReason({ ...base, notRanked: "x", rank: null })).toMatch(/did not quote every item/);
    expect(regretReason(base)).toBe("Your offer was technically acceptable and ranked 2nd of 3 on the combined technical (70 %) and financial (30 %) score. The award went to the offer with the highest combined score, from Nile Medical.");
    expect(regretReason({ ...base, rank: null })).toMatch(/recommended the award to Nile Medical/);
  });
});

describe("letterFor", () => {
  it("gives the winner an award letter and the others a regret letter, withdrawn offers none", () => {
    expect(letterFor({ id: 1, status: "AWARDED" }, 1)).toBe("award");
    expect(letterFor({ id: 2, status: "SHORTLISTED" }, 1)).toBe("regret");
    expect(letterFor({ id: 3, status: "REJECTED" }, 1)).toBe("regret");
    expect(letterFor({ id: 4, status: "WITHDRAWN" }, 1)).toBeNull();
    expect(letterFor({ id: 1, status: "AWARDED" }, null)).toBeNull();
  });
});
