import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  answerStatus, bidTemplateFileName, bidTemplateWorkbook, cellDate, cellNumber, importNote, readBidFile, readBidWorkbook, validateBid,
  type TemplateInput,
} from "./bid-import";

const input: TemplateInput = {
  rfqId: 7, rfqNumber: "RFQ-2026-0007", title: "Imaging equipment", projectCode: "T-2026-01", closingDate: "2026-12-15",
  supplier: { id: 3, name: "Nile Medical" },
  lines: [
    { deviceTypeId: 11, code: "IMG-CT-64", name: "CT scanner", quantity: 1, departments: ["Radiology"], boqLineIds: [101], specItems: [
      { id: 501, section: "Gantry", parameter: "Slices", requirement: "≥ 64", unit: null, mandatory: true },
      { id: 502, section: "Software", parameter: "Dose report", requirement: "Yes", unit: null, mandatory: false },
    ] },
    { deviceTypeId: 12, code: "IMG-XR-MOB", name: "Mobile X-ray", quantity: 2, departments: [], boqLineIds: [102, 103], specItems: [
      { id: 601, section: null, parameter: "Power", requirement: "≥ 30 kW", unit: "kW", mandatory: true },
    ] },
    { deviceTypeId: 13, code: "MON-PAT-HIGH", name: "Patient monitor", quantity: null, departments: [], boqLineIds: [], specItems: [] },
  ],
};
const ctx = { rfqId: 7, supplierId: 3, lines: input.lines };

/** Fill the template as a supplier would, then write and re-open it, as an upload does. */
async function filled(edit: (bid: ExcelJS.Worksheet, comp: ExcelJS.Worksheet) => void) {
  const wb = bidTemplateWorkbook(input);
  edit(wb.getWorksheet("Bid")!, wb.getWorksheet("Compliance")!);
  const buf = await wb.xlsx.writeBuffer();
  return readBidFile(buf as ArrayBuffer);
}

function goodBid(bid: ExcelJS.Worksheet, comp: ExcelJS.Worksheet) {
  bid.getCell("C5").value = "Q-123";
  bid.getCell("C6").value = new Date(Date.UTC(2026, 10, 20));
  bid.getCell("C7").value = "2027-02-20";
  bid.getCell("C8").value = "usd";
  bid.getCell("C9").value = "CIF";
  bid.getCell("C10").value = "30 % advance";
  // Row 13 = CT, 14 = X-ray, 15 = monitor (not quoted).
  bid.getRow(13).getCell(5).value = 450000; bid.getRow(13).getCell(6).value = 5; bid.getRow(13).getCell(7).value = "GE";
  bid.getRow(13).getCell(8).value = "Revolution"; bid.getRow(13).getCell(9).value = "Japan"; bid.getRow(13).getCell(10).value = 16; bid.getRow(13).getCell(11).value = 24;
  bid.getRow(14).getCell(5).value = "38,500.50"; bid.getRow(14).getCell(10).value = 8; bid.getRow(14).getCell(11).value = 12;
  // Compliance rows: 2 = CT slices, 3 = CT dose report, 4 = X-ray power.
  comp.getRow(2).getCell(9).value = "Yes"; comp.getRow(2).getCell(10).value = "128 slices"; comp.getRow(2).getCell(12).value = "p. 4";
  comp.getRow(3).getCell(9).value = "Partial";
  comp.getRow(4).getCell(9).value = "yes";
}

describe("bid template", () => {
  it("has a row per RFQ line and a compliance row per spec item, no prices", async () => {
    const wb = bidTemplateWorkbook(input);
    const bid = wb.getWorksheet("Bid")!;
    expect(bid.getRow(12).getCell(5).value).toBe("Unit price");
    expect([13, 14, 15].map((r) => bid.getRow(r).getCell(2).value)).toEqual(["IMG-CT-64", "IMG-XR-MOB", "MON-PAT-HIGH"]);
    expect(bid.getRow(14).getCell(4).value).toBe(2);
    expect(bid.getRow(13).getCell(5).value).toBeNull();
    const comp = wb.getWorksheet("Compliance")!;
    expect([2, 3, 4].map((r) => comp.getRow(r).getCell(3).value)).toEqual([501, 502, 601]);
    expect(comp.getRow(2).getCell(8).value).toBe("Mandatory");
    expect(wb.getWorksheet("Read me")).toBeTruthy();
    expect(bidTemplateFileName("RFQ-2026-0007", "Nile/Medical")).toBe("RFQ-2026-0007 bid template - Nile Medical.xlsx");
  });

  it("an untouched template reads back with no prices", async () => {
    const raw = await filled(() => {});
    expect(raw.rfqTag).toBe("rfq:7");
    expect(raw.supplierTag).toBe("supplier:3");
    const check = validateBid(raw, ctx);
    expect(check.lines).toEqual([]);
    expect(check.errors.map((e) => e.message)).toEqual(expect.arrayContaining(["Fill in the quotation reference.", "Fill in the offer date."]));
  });
});

describe("reading and checking a filled bid", () => {
  it("parses a good bid", async () => {
    const check = validateBid(await filled(goodBid), ctx);
    expect(check.errors).toEqual([]);
    expect(check.header).toEqual({ reference: "Q-123", offerDate: "2026-11-20", validUntil: "2027-02-20", currency: "USD", incoterm: "CIF", paymentTerms: "30 % advance" });
    expect(check.lines.map((l) => [l.code, l.quantity, l.unitPrice, l.discountPct, l.boqLineId])).toEqual([["IMG-CT-64", 1, 450000, 5, 101], ["IMG-XR-MOB", 2, 38500.5, 0, null]]);
    expect(check.lines[0]).toMatchObject({ manufacturer: "GE", model: "Revolution", countryOfOrigin: "Japan", deliveryWeeks: 16, warrantyMonths: 24 });
    expect(check.lines[0].compliance).toEqual([
      { specItemId: 501, status: "COMPLIES", offeredValue: "128 slices", remark: null, pageRef: "p. 4" },
      { specItemId: 502, status: "PARTIAL", offeredValue: null, remark: null, pageRef: null },
    ]);
    expect(check.notQuoted).toEqual(["Patient monitor"]);
    expect(check.deliveryWeeks).toBe(16);
    expect(check.warrantyMonths).toBe(12);
    expect(check.warnings.map((w) => w.message).join(" ")).toMatch(/without a remark/);
    expect(importNote("bid.xlsx", check)).toContain("IMG-CT-64: delivery 16 weeks; warranty 24 months");
  });

  it("flags non-numeric prices, unknown rows and missing mandatory answers", async () => {
    const check = validateBid(await filled((bid, comp) => {
      goodBid(bid, comp);
      bid.getRow(13).getCell(5).value = "about 450k";
      bid.getRow(16).getCell(2).value = "NOT-A-CODE"; bid.getRow(16).getCell(5).value = 10;
      comp.getRow(4).getCell(9).value = null; // X-ray mandatory power unanswered
    }), ctx);
    const msgs = check.errors.map((e) => `${e.where}: ${e.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Bid sheet row 13: CT scanner: the unit price "about 450k" isn't a number/),
      expect.stringMatching(/^Bid sheet row 16: "NOT-A-CODE" isn't an item of this RFQ/),
      expect.stringMatching(/Mobile X-ray: answer the mandatory line "Power"/),
    ]));
  });

  it("flags a bad answer, a changed Ref, a bad discount and a quantity left to the offer", async () => {
    const check = validateBid(await filled((bid, comp) => {
      goodBid(bid, comp);
      bid.getRow(13).getCell(6).value = 150;
      bid.getRow(15).getCell(5).value = 900; // monitor priced, but the RFQ has no quantity and none given
      comp.getRow(2).getCell(9).value = "maybe";
      comp.getRow(4).getCell(3).value = 999;
    }), ctx);
    const msgs = check.errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/discount "150"/);
    expect(msgs).toMatch(/Patient monitor: give the quantity/);
    expect(msgs).toMatch(/answer Yes, No or Partial, not "maybe"/);
    expect(msgs).toMatch(/The Ref "999" isn't a specification line of Mobile X-ray/);
  });

  it("refuses another RFQ's or another supplier's file", async () => {
    const raw = await filled(goodBid);
    expect(validateBid(raw, { ...ctx, rfqId: 8 }).errors[0].message).toMatch(/another RFQ/);
    expect(validateBid(raw, { ...ctx, supplierId: 4 }).errors[0].message).toMatch(/another supplier/);
  });

  it("refuses a file that isn't a workbook or lacks the sheet", async () => {
    const notXlsx = await readBidFile(new TextEncoder().encode("hello").buffer as ArrayBuffer);
    expect(validateBid(notXlsx, ctx).errors[0].message).toMatch(/couldn't be opened/);
    const empty = new ExcelJS.Workbook(); empty.addWorksheet("Sheet1");
    expect(readBidWorkbook(empty).problems[0]).toMatch(/no "Bid" sheet/);
  });
});

describe("cell helpers", () => {
  it("numbers", () => {
    expect(cellNumber("1,234.50")).toBe(1234.5);
    expect(cellNumber("USD 99")).toBe(99);
    expect(cellNumber("5%")).toBe(5);
    expect(cellNumber("abc")).toBe("bad");
    expect(cellNumber(null)).toBeNull();
  });
  it("dates", () => {
    expect(cellDate("2026-11-23")).toBe("2026-11-23");
    expect(cellDate("23/11/2026")).toBe("2026-11-23");
    expect(cellDate("31/02/2026")).toBe("bad");
    expect(cellDate(46349)).toBe("2026-11-23");
    expect(cellDate("soon")).toBe("bad");
  });
  it("answers", () => {
    expect(answerStatus("Y")).toBe("COMPLIES");
    expect(answerStatus("No")).toBe("NOT_COMPLIANT");
    expect(answerStatus("partial")).toBe("PARTIAL");
    expect(answerStatus(null)).toBeNull();
    expect(answerStatus("?")).toBe("bad");
  });
});
