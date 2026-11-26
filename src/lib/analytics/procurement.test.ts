import { describe, expect, it } from "vitest";
import { FxTable } from "../fx";
import {
  competition, competitionBy, daysLate, modelKey, priceBenchmarks, priceFlags, singleBidTone, supplierScores, toPricePoints,
  type PricePoint, type RawPrice, type SupplierFacts, type TenderUnit,
} from "./procurement";

const unit = (o: Partial<TenderUnit>): TenderUnit => ({
  key: "r1", label: "RFQ", href: "/x", method: null, categories: ["Imaging"], issued: "2026-01-01", bids: 3, closed: true, awardedOn: null, ...o,
});

describe("tender competition", () => {
  it("has no shares without tenders", () => {
    const c = competition([]);
    expect(c.singleBidShare).toBeNull();
    expect(c.noOfferShare).toBeNull();
    expect(c.medianDecisionDays).toBeNull();
  });

  it("counts single bids among tenders that got bids, and no-offer tenders among closed ones", () => {
    const c = competition([unit({ bids: 1 }), unit({ bids: 2 }), unit({ bids: 0 }), unit({ bids: 1 }), unit({ bids: 0, closed: false })]);
    expect(c.units).toBe(5);
    expect(c.closed).toBe(4);
    expect(c.singleBid).toBe(2);
    expect(c.singleBidShare).toBeCloseTo(2 / 3);
    expect(c.noOfferShare).toBeCloseTo(1 / 4);
    expect(c.meanBids).toBeCloseTo(4 / 3);
  });

  it("gives no single-bid share when every closed tender had no offer", () => {
    const c = competition([unit({ bids: 0 }), unit({ bids: 0 })]);
    expect(c.singleBidShare).toBeNull();
    expect(c.noOfferShare).toBe(1);
  });

  it("measures decision time from issue to award and ignores awards dated before issue", () => {
    const c = competition([
      unit({ issued: "2026-01-01", awardedOn: "2026-03-02" }), unit({ issued: "2026-01-01", awardedOn: "2026-06-01" }),
      unit({ issued: "2026-05-01", awardedOn: "2026-04-01" }), unit({ issued: null, awardedOn: "2026-04-01" }),
    ]);
    expect(c.decisionDays).toEqual([60, 151]);
    expect(c.overBenchmark).toBe(1);
  });

  it("rates the single-bid share against the scoreboard", () => {
    expect(singleBidTone(0.1)).toBe("ok");
    expect(singleBidTone(0.2)).toBe("warn");
    expect(singleBidTone(0.21)).toBe("danger");
    expect(singleBidTone(null)).toBeNull();
  });

  it("groups by category, a tender counting once in each of its categories", () => {
    const g = competitionBy([unit({ categories: ["Imaging", "ICU", "Imaging"] }), unit({ categories: ["Imaging"], bids: 1 })], (u) => u.categories);
    expect(g.map((x) => [x.key, x.units, x.singleBid])).toEqual([["Imaging", 2, 1], ["ICU", 1, 0]]);
  });
});

const fx = new FxTable([{ currency: "USD", rateToEgp: 30, effectiveDate: "2025-01-01" }, { currency: "USD", rateToEgp: 50, effectiveDate: "2026-01-01" }]);
const raw = (o: Partial<RawPrice>): RawPrice => ({
  source: "PO", lineId: 1, offerId: null, ref: "PO-1", href: "/po/1", deviceTypeId: 7, typeName: "Monitor", manufacturer: "Acme", model: "M1",
  date: "2026-02-01", currency: "EGP", unitPrice: 1000, discountPct: 0, ...o,
});

describe("prices", () => {
  it("converts at the rate on the price's date, after discount, and lists missing rates", () => {
    const { points, missing } = toPricePoints([
      raw({ currency: "USD", unitPrice: 100, date: "2025-05-01" }), raw({ currency: "USD", unitPrice: 100, date: "2026-05-01", discountPct: 10 }),
      raw({ currency: "CHF", unitPrice: 5 }), raw({ unitPrice: 0 }),
    ], fx);
    expect(points.map((p) => p.egp)).toEqual([3000, 4500]);
    expect(missing).toEqual(["CHF"]);
  });

  it("keys models without case or spacing differences", () => {
    expect(modelKey(" Philips ", "Ingenia  1.5T")).toBe(modelKey("philips", "ingenia 1.5t"));
    expect(modelKey("Philips", "")).toBeNull();
  });

  const pts = (prices: number[], o: Partial<RawPrice> = {}) => toPricePoints(prices.map((p, i) => raw({ unitPrice: p, lineId: i + 1, date: `2025-0${(i % 9) + 1}-01`, ...o })), fx).points;

  it("hides benchmarks under five prices", () => {
    const b = priceBenchmarks(pts([100, 110, 120, 130]));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ n: 4, shown: false, median: null });
    const c = priceBenchmarks(pts([100, 110, 120, 130, 140]));
    expect(c[0]).toMatchObject({ n: 5, shown: true, median: 120, min: 100, max: 140 });
  });

  it("adds a line per model when a type has several", () => {
    const b = priceBenchmarks([...pts([100, 100, 100, 100, 100]), ...pts([200, 200], { model: "M2" })]);
    expect(b.map((x) => [x.model, x.n])).toEqual([[null, 7], ["Acme M1", 5], ["Acme M2", 2]]);
  });

  it("flags an offer well above earlier prices, and only against earlier prices", () => {
    const history = pts([1000, 1050, 980, 1020, 1010, 990]);
    const [high] = toPricePoints([raw({ source: "OFFER", offerId: 9, unitPrice: 2000, date: "2026-03-01" })], fx).points;
    const [fair] = toPricePoints([raw({ source: "OFFER", offerId: 9, lineId: 2, unitPrice: 1040, date: "2026-03-01" })], fx).points;
    const flags = priceFlags([high, fair], history);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ basis: "model", n: 6, median: 1005 });
    expect(flags[0].z).toBeGreaterThan(3.5);
    // Dated before every earlier price: nothing to compare with.
    const [early] = toPricePoints([raw({ source: "OFFER", offerId: 9, unitPrice: 2000, date: "2024-01-01" })], fx).points;
    expect(priceFlags([early], history)).toEqual([]);
  });

  it("compares offers in another currency at the rate of the offer date", () => {
    const history = pts([1000, 1050, 980, 1020, 1010, 990]);
    // 40 USD at 50 = 2,000 EGP in 2026: flagged; at the 2025 rate it would be 1,200.
    const [usd] = toPricePoints([raw({ source: "OFFER", offerId: 3, currency: "USD", unitPrice: 40, date: "2026-03-01" })], fx).points;
    expect(priceFlags([usd], history)).toHaveLength(1);
  });

  it("falls back to the device type when the model has too few prices, and needs MIN_N", () => {
    const history: PricePoint[] = [...pts([1000, 1010, 990, 1020], { model: "Other" }), ...pts([1005])];
    const [o] = toPricePoints([raw({ source: "OFFER", offerId: 1, unitPrice: 5000, date: "2026-03-01" })], fx).points;
    expect(priceFlags([o], history)[0]).toMatchObject({ basis: "type", n: 5 });
    expect(priceFlags([o], history.slice(0, 4))).toEqual([]);
  });

  it("never compares an offer with its own lines", () => {
    const history = pts([1000, 1050, 980, 1020, 1010], { source: "OFFER", offerId: 4 });
    const [o] = toPricePoints([raw({ source: "OFFER", offerId: 4, unitPrice: 5000, date: "2026-03-01" })], fx).points;
    expect(priceFlags([o], history)).toEqual([]);
  });
});

const facts = (o: Partial<SupplierFacts>): SupplierFacts => ({
  supplierId: 1, name: "A", deliveries: [], penaltyCount: 0, penaltyEgp: 0, devicesInstalled: 0, devicesEarlyFault: 0, contracts: [], responseHours: [], awards: 0, ...o,
});

describe("supplier scorecard", () => {
  it("works out on-time share, delay, early faults, uptime and response", () => {
    const [s] = supplierScores([facts({ deliveries: [-2, 0, 5, 10], devicesInstalled: 4, devicesEarlyFault: 1,
      contracts: [{ target: 95, actual: 97 }, { target: 98, actual: 96 }, { target: 95, actual: null }], responseHours: [2, 4, 30] })]);
    expect(s.onTimeShare).toBe(0.5);
    expect(s.avgDelayDays).toBe(3.75);
    expect(s.earlyFaultShare).toBe(0.25);
    expect([s.uptimeMet, s.uptimeOf]).toEqual([1, 2]);
    expect(s.medianResponseH).toBe(4);
    expect(s.rank).toBeNull(); // 4 deliveries: too few to rank
  });

  it("ranks only suppliers with at least five deliveries", () => {
    const rows = supplierScores([
      facts({ supplierId: 1, name: "Few", deliveries: [0, 0] }),
      facts({ supplierId: 2, name: "Late", deliveries: [5, 5, 0, 0, 0] }),
      facts({ supplierId: 3, name: "Good", deliveries: [0, 0, 0, 0, -1] }),
    ]);
    expect(rows.map((r) => [r.name, r.rank])).toEqual([["Good", 1], ["Late", 2], ["Few", null]]);
  });

  it("reads days late from receipts, and counts open late orders up to today", () => {
    expect(daysLate({ expected: "2026-03-01", status: "DELIVERED", lastDelivery: "2026-03-11" }, "2026-11-26")).toBe(10);
    expect(daysLate({ expected: "2026-03-01", status: "ISSUED", lastDelivery: null }, "2026-03-05")).toBe(4);
    expect(daysLate({ expected: "2026-12-01", status: "ISSUED", lastDelivery: null }, "2026-11-26")).toBeNull();
  });
});
