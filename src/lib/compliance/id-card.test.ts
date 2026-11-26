import { describe, expect, it } from "vitest";
import { phoneProblem, runningContract, vendorLine } from "./id-card";

const contract = { number: "SC-2026-0001", supplierName: "Medi Ltd", contactName: "Duty desk", contactPhone: "+20 2 1234 5678", startDate: "2026-01-01", endDate: "2026-12-31" };

describe("equipment ID card", () => {
  it("prefers the contract line, then the service contact, the card, the supplier", () => {
    const supplier = { name: "Medi Ltd", phone: "0100" };
    const contacts = [{ name: "Sales", role: "SALES", phone: "1" }, { name: "Service desk", role: "SERVICE", phone: "0123" }];
    expect(vendorLine({ contract, contacts, cardPhone: "9", supplier })).toMatchObject({ phone: "+20 2 1234 5678", source: "contract" });
    expect(vendorLine({ contract: { ...contract, contactPhone: null }, contacts, cardPhone: "9", supplier })).toMatchObject({ phone: "0123", name: "Service desk", source: "service_contact" });
    expect(vendorLine({ contract: null, contacts: contacts.slice(0, 1), cardPhone: " 0222 ", supplier })).toMatchObject({ phone: "0222", source: "card" });
    expect(vendorLine({ contract: null, contacts: [], cardPhone: null, supplier })).toMatchObject({ phone: "0100", source: "supplier" });
    expect(vendorLine({ contract: null, contacts: [], cardPhone: null, supplier: null })).toMatchObject({ phone: null, source: null });
  });
  it("finds the running contract", () => {
    const old = { ...contract, number: "old", startDate: "2024-01-01", endDate: "2025-12-31" };
    expect(runningContract([old, contract], "2026-06-01")?.number).toBe("SC-2026-0001");
    expect(runningContract([old], "2026-06-01")).toBeNull();
  });
  it("checks typed phone numbers", () => {
    expect(phoneProblem("+20 (2) 2345-6789")).toBeNull();
    expect(phoneProblem("2345 ext 12")).toBeNull();
    expect(phoneProblem("")).toBeNull();
    expect(phoneProblem("call Ahmed")).toBeTruthy();
  });
});
