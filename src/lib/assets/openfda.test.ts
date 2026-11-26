import { describe, expect, it } from "vitest";
import { candidates, csvRecords, fdaDate, firmTokens, matchRow, parseFdaFile, sameFirm, toRow } from "./openfda";
import { annexGaps, mayAcknowledge, pendingAcknowledgements, quarantineBlock, releaseProblem, sourceLabel } from "./vigilance";

const devices = [
  { id: 1, tag: "DGH-CT-000001", facilityId: 1, manufacturer: "Siemens Healthineers", model: "SOMATOM go.Up" },
  { id: 2, tag: "DGH-MRI-000002", facilityId: 1, manufacturer: "GE", model: "SIGNA Explorer" },
  { id: 3, tag: "DGH-US-000003", facilityId: 2, manufacturer: "Philips", model: "EPIQ 7" },
  { id: 4, tag: "DGH-MON-000004", facilityId: 1, manufacturer: "Philips", model: "MX" },
];

describe("openFDA recall files (wave 40)", () => {
  it("reads openFDA JSON and its dates", () => {
    const json = JSON.stringify({ meta: {}, results: [{ product_res_number: "Z-1234-2026", recalling_firm: "Siemens Medical Solutions USA, Inc.", product_description: "SOMATOM go.Up computed tomography system", code_info: "Serial 1000-1200", reason_for_recall: "Software error", event_date_initiated: "20260315", recall_status: "Open, Classified" }] });
    const f = parseFdaFile(json);
    expect(f.kind).toBe("recall");
    expect(f.rows[0]).toMatchObject({ fdaNumber: "Z-1234-2026", firm: "Siemens Medical Solutions USA, Inc.", initiatedOn: "2026-03-15", fdaStatus: "Open, Classified" });
    expect(parseFdaFile(JSON.stringify({ results: [{ recall_number: "Z-1-2026", recalling_firm: "GE", report_date: "20260101" }] })).kind).toBe("enforcement");
    expect(parseFdaFile("{bad").problem).toContain("not valid JSON");
    expect(fdaDate("03/05/2026")).toBe("2026-03-05");
    expect(fdaDate("2026-03-05T00:00")).toBe("2026-03-05");
    expect(fdaDate("soon")).toBeNull();
  });
  it("reads CSV with quotes and any heading case", () => {
    expect(csvRecords('a,b\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    const f = parseFdaFile('Recall Number,Recalling Firm,Product Description,Recall Initiation Date\nZ-9-2026,"GE Medical Systems, LLC",SIGNA Explorer MR system,20260201\n');
    expect(f.kind).toBe("enforcement");
    expect(f.rows[0]).toMatchObject({ fdaNumber: "Z-9-2026", firm: "GE Medical Systems, LLC", product: "SIGNA Explorer MR system", initiatedOn: "2026-02-01" });
    expect(toRow({ "product-description": "x" }).product).toBe("x");
  });
  it("matches makers despite legal and trade words", () => {
    expect(firmTokens("Siemens Medical Solutions USA, Inc.")).toEqual(["siemens"]);
    expect(sameFirm("Siemens Medical Solutions USA, Inc.", "Siemens Healthineers")).toBe(true);
    expect(sameFirm("GE Medical Systems, LLC", "GE Healthcare")).toBe(true);
    expect(sameFirm("Koninklijke Philips N.V.", "Philips")).toBe(true);
    expect(sameFirm("Philips", "Siemens")).toBe(false);
    expect(sameFirm("Medical Systems Inc", "Medical Corp")).toBe(false);
  });
  it("finds devices by maker and model and leaves known notices out", () => {
    const row = toRow({ recalling_firm: "Siemens Medical Solutions USA, Inc.", product_description: "SOMATOM go.Up CT", product_res_number: "Z-1" });
    expect(matchRow(row, devices)).toEqual([{ assetId: 1, tag: "DGH-CT-000001", facilityId: 1, score: 2, why: "Siemens Healthineers SOMATOM go.Up" }]);
    const squashed = toRow({ recalling_firm: "Philips Ultrasound, Inc.", product_description: "Ultrasound system EPIQ7 and EPIQ 5", code_info: "MX series not affected" });
    // "MX" is too short to match; "EPIQ 7" matches "EPIQ7" (score 1: not word for word)
    expect(matchRow(squashed, devices).map((m) => [m.assetId, m.score])).toEqual([[3, 1]]);
    expect(matchRow(toRow({ recalling_firm: "Acme", product_description: "SOMATOM go.Up" }), devices)).toEqual([]);
    const c = candidates([row, squashed], devices, new Set(["z-1"]));
    expect(c.map((x) => x.matches[0].assetId)).toEqual([3]);
  });
});

describe("EDA vigilance rules (wave 40)", () => {
  const hold = { id: 1, reason: "Patient burn", placedAt: "2026-11-20", placedByName: "Omar" };
  it("blocks repair and disposal of a device kept as found, but not inspection", () => {
    expect(quarantineBlock(null, "work", "CORRECTIVE")).toBeNull();
    expect(quarantineBlock(hold, "work", "CORRECTIVE")).toContain("kept as found (quarantined by Omar: Patient burn)");
    expect(quarantineBlock(hold, "work", "INSPECTION")).toBeNull();
    expect(quarantineBlock(hold, "disposal")).toContain("can't be disposed of");
    expect(releaseProblem(hold, " ")).toContain("Say why");
    expect(releaseProblem(null, "ok")).toContain("not kept");
    expect(releaseProblem(hold, "Maker inspected it")).toBeNull();
  });
  it("labels recall sources and tracks department acknowledgements", () => {
    expect(sourceLabel("MAKER_FSN")).toBe("Maker's field safety notice");
    expect(sourceLabel("Manufacturer")).toBe("Manufacturer");
    expect(pendingAcknowledgements([{ departmentId: 3 }, { departmentId: 2 }, { departmentId: null }, { departmentId: 3 }], [{ departmentId: 2 }])).toEqual([3]);
    expect(mayAcknowledge({ canManage: false, isHead: true, myDepartments: new Set([3]) }, 3)).toBe(true);
    expect(mayAcknowledge({ canManage: false, isHead: true, myDepartments: new Set([3]) }, 4)).toBe(false);
    expect(mayAcknowledge({ canManage: true, isHead: false, myDepartments: new Set() }, 4)).toBe(true);
  });
  it("lists the EDA Annex 2 fields still blank", () => {
    expect(annexGaps({ reporter: "A", deviceName: "CT", maker: "S", model: "M", serialOrLot: "", incidentDate: "2026-11-20", description: "d", outcome: "None", actions: null, keptAt: "Store 2" }))
      .toEqual(["serial or lot number", "actions taken"]);
  });
});
