import { describe, expect, it } from "vitest";
import { hidePrices, PRICES_HIDDEN_NOTE } from "./hide-prices";
import type { ReportResult } from "./types";

const report: ReportResult = {
  summary: [{ label: "Service cost", value: "EGP 1M", money: true }, { label: "COSR per year", value: "4 %" }],
  sections: [{
    key: "types", empty: "",
    columns: [{ key: "type", header: "Device type" }, { key: "totalEgp", header: "Service cost (EGP)", type: "egp" }, { key: "price", header: "Price", type: "money", currencyKey: "cur" }, { key: "cosr", header: "COSR", type: "pct" }],
    rows: [{ type: "CT", totalEgp: 1000, price: 5, cur: "USD", cosr: 4 }],
    totals: { type: "All", totalEgp: 1000, cosr: 4 },
  }],
};

describe("reports without price access", () => {
  it("takes out money columns, values and summary figures, and keeps ratios", () => {
    const r = hidePrices(report);
    expect(r.summary).toEqual([{ label: "COSR per year", value: "4 %" }]);
    expect(r.sections[0].columns.map((c) => c.key)).toEqual(["type", "cosr"]);
    expect(r.sections[0].rows[0]).toEqual({ type: "CT", cur: "USD", cosr: 4 });
    expect(r.sections[0].totals).toEqual({ type: "All", cosr: 4 });
    expect(JSON.stringify(r)).not.toContain("1000");
    expect(r.notes).toContain(PRICES_HIDDEN_NOTE);
  });

  it("leaves a report without money as it is", () => {
    const plain: ReportResult = { sections: [{ key: "a", empty: "", columns: [{ key: "x", header: "X" }], rows: [{ x: 1 }] }] };
    expect(hidePrices(plain)).toBe(plain);
  });
});
