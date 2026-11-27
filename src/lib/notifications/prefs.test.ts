import { describe, expect, it } from "vitest";
import { delivery, digestDue, digestEmail, effectiveChannel, groupDigest, isSafetyKind, ungroupedKinds, zonedHour } from "./prefs";

describe("notification choices (wave 41)", () => {
  it("uses the person's choice, then the role default, then both", () => {
    expect(effectiveChannel("po_late", "APP", "FINANCE", { FINANCE: { po_late: "OFF" } })).toBe("APP");
    expect(effectiveChannel("po_late", null, "FINANCE", { FINANCE: { po_late: "OFF" } })).toBe("OFF");
    expect(effectiveChannel("po_late", "nonsense", "VIEWER", {})).toBe("BOTH");
  });
  it("keeps the inbox on for safety-critical kinds", () => {
    expect(isSafetyKind("recall_issued")).toBe(true);
    expect(effectiveChannel("critical_backup", "OFF", "BIOMEDICAL", {})).toBe("APP");
    expect(effectiveChannel("fault_escalated", "EMAIL", "BIOMEDICAL", {})).toBe("BOTH");
    expect(effectiveChannel("incident_reported", null, "BIOMEDICAL", { BIOMEDICAL: { incident_reported: "OFF" } })).toBe("APP");
  });
  it("turns a channel into what happens", () => {
    expect(delivery("po_late", "OFF", false)).toEqual({ store: false, inbox: false, emailNow: false, digest: false });
    expect(delivery("po_late", "EMAIL", false)).toEqual({ store: true, inbox: false, emailNow: true, digest: false });
    expect(delivery("po_late", "BOTH", true)).toEqual({ store: true, inbox: true, emailNow: false, digest: true });
    expect(delivery("po_late", "APP", true)).toEqual({ store: true, inbox: true, emailNow: false, digest: false });
    // Safety kinds are emailed at once even with the digest on.
    expect(delivery("recall_issued", "BOTH", true)).toMatchObject({ emailNow: true, digest: false });
  });
  it("gives every inbox kind a place on the settings page", () => {
    expect(ungroupedKinds()).toEqual([]);
  });
});

describe("daily digest (wave 41)", () => {
  // 2026-11-26 06:30 UTC = 08:30 in Cairo (UTC+2 in winter).
  const now = new Date("2026-11-26T06:30:00Z");
  it("reads the hour in Cairo", () => { expect(zonedHour(now)).toBe(8); });
  it("is due once a day from the chosen hour", () => {
    expect(digestDue({ enabled: true, hour: 8, lastSentOn: "2026-11-25" }, now)).toBe(true);
    expect(digestDue({ enabled: true, hour: 9, lastSentOn: "2026-11-25" }, now)).toBe(false);
    expect(digestDue({ enabled: true, hour: 7, lastSentOn: "2026-11-26" }, now)).toBe(false);
    expect(digestDue({ enabled: false, hour: 0, lastSentOn: null }, now)).toBe(false);
  });
  it("groups by kind, safety first, newest first, with links", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 25, h));
    const groups = groupDigest([
      { kind: "po_late", title: "PO 1 late", createdAt: at(1), href: "/procurement/purchase-orders/1" },
      { kind: "warranty_ending", title: "Warranty A", createdAt: at(2) },
      { kind: "po_late", title: "PO 2 late", createdAt: at(3) },
      { kind: "recall_pending", title: "Recall X", createdAt: at(4) },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["recall_pending", "po_late", "warranty_ending"]);
    expect(groups[1].items.map((i) => i.title)).toEqual(["PO 2 late", "PO 1 late"]);
    const m = digestEmail(groups, "https://pams.example.eg/", "2026-11-26");
    expect(m.subject).toBe("[Hospital PAMS] Daily digest: 4 items");
    expect(m.text).toContain("Late delivery (2)");
    expect(m.text).toContain("https://pams.example.eg/procurement/purchase-orders/1");
  });
});
