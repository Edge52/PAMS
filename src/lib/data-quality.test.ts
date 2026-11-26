import { describe, expect, it } from "vitest";
import { duplicateSerials, evaluate, hospitalScores, ppmDueUnplanned, recordHref, RULES, SCORED_RULES, serialKey, sortResults, type DqAsset, type DqData } from "./data-quality";

const TODAY = "2026-11-26";
let n = 0;
const asset = (o: Partial<DqAsset> = {}): DqAsset => ({
  id: ++n, facilityId: 1, tag: `T-${n}`, status: "IN_SERVICE", condition: "GOOD", serial: `SN${n}`, manufacturer: "Acme", model: "X1",
  installDate: "2026-06-01", purchaseDate: "2026-05-01", purchaseCost: "1000.00", roomId: 5, criticality: "HIGH", gmdnCode: "12345",
  ppmIntervalMonths: 12, strategy: "MANUFACTURER", lastPpm: null, ppmPlanned: true, openJob: false, ...o,
});
const data = (o: Partial<DqData> = {}): DqData => ({ assets: [], workOrders: [], pos: [], offers: [], contracts: [], rated: new Set(["USD"]), coveredNow: new Set(), ...o });
const hitsOf = (d: DqData, id: string) => evaluate(d, TODAY).find((r) => r.rule.id === id)!.hits.map((h) => h.label);

describe("asset rules", () => {
  it("a complete device passes every rule", () => {
    const d = data({ assets: [asset()] });
    expect(evaluate(d, TODAY).filter((r) => r.rule.entity === "asset" && r.hits.length)).toEqual([]);
  });
  it("finds missing fields", () => {
    const a = asset({ serial: " ", manufacturer: null, installDate: null, purchaseCost: null, roomId: null, criticality: null, gmdnCode: null });
    const d = data({ assets: [a] });
    for (const id of ["no-serial", "no-make-model", "no-install-date", "no-cost", "no-room", "no-criticality", "no-gmdn"]) expect(hitsOf(d, id)).toEqual([a.tag]);
  });
  it("does not ask for a room or install date while in store", () => {
    const d = data({ assets: [asset({ status: "IN_STOCK", roomId: null, installDate: null })] });
    expect(hitsOf(d, "no-room")).toEqual([]);
    expect(hitsOf(d, "no-install-date")).toEqual([]);
  });
  it("ignores disposed devices", () => {
    expect(hitsOf(data({ assets: [asset({ status: "DISPOSED", serial: null })] }), "no-serial")).toEqual([]);
  });
  it("out of service with no open job, unless condemned", () => {
    const a = asset({ status: "OUT_OF_SERVICE" }), b = asset({ status: "OUT_OF_SERVICE", openJob: true }), c = asset({ status: "OUT_OF_SERVICE", condition: "CONDEMNED" });
    expect(hitsOf(data({ assets: [a, b, c] }), "down-no-job")).toEqual([a.tag]);
  });
});

describe("PPM due but unplanned", () => {
  it("due by install date and nothing planned", () => {
    expect(ppmDueUnplanned(asset({ installDate: "2025-10-01", ppmPlanned: false }), TODAY)).toBe(true);
  });
  it("due within 30 days counts; later does not", () => {
    expect(ppmDueUnplanned(asset({ installDate: "2025-12-20", ppmIntervalMonths: 12, ppmPlanned: false }), TODAY)).toBe(true);
    expect(ppmDueUnplanned(asset({ installDate: "2026-06-01", ppmPlanned: false }), TODAY)).toBe(false);
  });
  it("a planned visit or run to failure clears it", () => {
    expect(ppmDueUnplanned(asset({ installDate: "2025-01-01", ppmPlanned: true }), TODAY)).toBe(false);
    expect(ppmDueUnplanned(asset({ installDate: "2025-01-01", ppmPlanned: false, strategy: "RUN_TO_FAILURE" }), TODAY)).toBe(false);
  });
});

describe("duplicate serials", () => {
  it("matches without case, spaces or dashes, per maker", () => {
    expect(serialKey(" ab-12 3 ")).toBe("AB123");
    const a = asset({ serial: "AB-123" }), b = asset({ serial: "ab 123" }), c = asset({ serial: "AB123", manufacturer: "Other" }), dsp = asset({ serial: "AB123", status: "DISPOSED" });
    expect([...duplicateSerials([a, b, c, dsp])].sort()).toEqual([a.id, b.id].sort());
  });
});

describe("other rules", () => {
  const wo = (o: object) => ({ id: ++n, facilityId: 1, number: `WO-${n}`, status: "CLOSED", reportedAt: "2026-10-01T08:00:00+00", laborHours: 2, deviceDown: false, downtimeStart: null, downtimeEnd: null, ...o });
  it("jobs without labour or downtime, and old open jobs", () => {
    const noLab = wo({ laborHours: null }), noDown = wo({ deviceDown: true, downtimeStart: "2026-10-01" }), old = wo({ status: "OPEN", reportedAt: "2026-08-01T00:00:00+00" }), fresh = wo({ status: "OPEN" });
    const d = data({ workOrders: [noLab, noDown, old, fresh] });
    expect(hitsOf(d, "job-no-labour")).toEqual([noLab.number]);
    expect(hitsOf(d, "job-no-downtime")).toEqual([noDown.number]);
    expect(hitsOf(d, "job-old-open")).toEqual([old.number]);
  });
  it("orders received over 60 days ago without an invoice", () => {
    const po = (o: object) => ({ id: ++n, facilityId: 1, number: `PO-${n}`, status: "DELIVERED", lastDelivery: "2026-08-01", invoiced: false, ...o });
    const late = po({}), invoiced = po({ invoiced: true }), recent = po({ lastDelivery: "2026-11-01" });
    expect(hitsOf(data({ pos: [late, invoiced, recent] }), "po-no-invoice")).toEqual([late.number]);
  });
  it("offers with no currency or no rate; EGP needs no rate", () => {
    const o = (currency: string | null, status = "RECEIVED") => ({ id: ++n, facilityId: 1, reference: `Q-${n}`, currency, status });
    const eur = o("EUR"), none = o(""), ok = [o("USD"), o("EGP"), o("CHF", "WITHDRAWN")];
    expect(hitsOf(data({ offers: [eur, none, ...ok] }), "offer-no-rate")).toEqual([eur.reference, none.reference]);
  });
  it("expired contract still linked to a device in use without other cover", () => {
    const a = asset(), b = asset();
    const expired = { id: ++n, facilityId: 1, number: "SC-1", endDate: "2026-01-01", assetIds: [a.id] };
    const renewed = { id: ++n, facilityId: 1, number: "SC-2", endDate: "2026-01-01", assetIds: [b.id] };
    const running = { id: ++n, facilityId: 1, number: "SC-3", endDate: "2027-01-01", assetIds: [a.id] };
    expect(hitsOf(data({ assets: [a, b], contracts: [expired, renewed, running], coveredNow: new Set([b.id]) }), "contract-expired-linked")).toEqual(["SC-1"]);
  });
});

describe("scores and ordering", () => {
  it("share of devices passing every device rule, per hospital", () => {
    const s = hospitalScores([asset(), asset({ serial: null }), asset({ facilityId: 2 }), asset({ status: "DISPOSED", serial: null })], TODAY);
    expect(s).toEqual([{ facilityId: 1, devices: 2, clean: 1, pct: 50 }, { facilityId: 2, devices: 1, clean: 1, pct: 100 }]);
  });
  it("low rules (GMDN) are listed but not scored", () => {
    const s = hospitalScores([asset({ facilityId: 3, gmdnCode: null }), asset({ facilityId: 3, purchaseCost: null })], TODAY);
    expect(s).toEqual([{ facilityId: 3, devices: 2, clean: 1, pct: 50 }]);
    expect(SCORED_RULES.some((r) => r.severity === "low")).toBe(false);
  });
  it("sorts by severity then count; skip leaves rules out", () => {
    const res = sortResults(evaluate(data({ assets: [asset({ gmdnCode: null }), asset({ serial: null })] }), TODAY, (r) => r.entity === "offer"));
    expect(res.some((r) => r.rule.entity === "offer")).toBe(false);
    expect(res[0].rule.severity).toBe("high");
    expect(res[0].rule.id).toBe("no-serial");
  });
  it("rule ids are unique and each entity has a link", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    expect(recordHref("work_order", 3)).toBe("/assets/work-orders/3");
  });
});
