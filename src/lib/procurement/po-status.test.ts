import { describe, expect, it } from "vitest";
import {
  allowedTransitions, canReceive, canSubmit, canTransition, transitionPermission, deliveryStateFor, deriveStatusAfterReceipt, isEditable, receivedPct, receivedTotals,
} from "./po-status";

const none = [{ quantity: 4, receivedQty: 0 }, { quantity: 2, receivedQty: 0 }];
const some = [{ quantity: 4, receivedQty: 2 }, { quantity: 2, receivedQty: 0 }];
const all = [{ quantity: 4, receivedQty: 4 }, { quantity: 2, receivedQty: 2 }];

describe("received quantities", () => {
  it("totals ordered and received units, capping over-receipts", () => {
    expect(receivedTotals(some)).toEqual({ ordered: 6, received: 2, outstanding: 4 });
    expect(receivedTotals([{ quantity: 2, receivedQty: 5 }])).toEqual({ ordered: 2, received: 2, outstanding: 0 });
  });
  it("computes percentage received", () => {
    expect(receivedPct([])).toBe(0);
    expect(receivedPct(some)).toBe(33);
    expect(receivedPct(all)).toBe(100);
  });
  it("derives delivery state", () => {
    expect(deliveryStateFor(none)).toBeNull();
    expect(deliveryStateFor(some)).toBe("PARTIALLY_DELIVERED");
    expect(deliveryStateFor(all)).toBe("DELIVERED");
  });
});

describe("deriveStatusAfterReceipt", () => {
  it("moves issued / acknowledged orders into delivery states", () => {
    expect(deriveStatusAfterReceipt("ISSUED", some)).toBe("PARTIALLY_DELIVERED");
    expect(deriveStatusAfterReceipt("ACKNOWLEDGED", all)).toBe("DELIVERED");
    expect(deriveStatusAfterReceipt("PARTIALLY_DELIVERED", all)).toBe("DELIVERED");
  });
  it("keeps the current status when nothing was received", () => {
    expect(deriveStatusAfterReceipt("ISSUED", none)).toBe("ISSUED");
  });
  it("never reopens closed or cancelled orders", () => {
    expect(deriveStatusAfterReceipt("CLOSED", some)).toBe("CLOSED");
    expect(deriveStatusAfterReceipt("CANCELLED", all)).toBe("CANCELLED");
  });
});

describe("transitions", () => {
  it("issues only approved orders with lines (drafts go through approval first)", () => {
    expect(canTransition("DRAFT", "ISSUED", none)).toBe(false);
    expect(canTransition("PENDING_APPROVAL", "ISSUED", none)).toBe(false);
    expect(canTransition("APPROVED", "ISSUED", none)).toBe(true);
    expect(canTransition("APPROVED", "ISSUED", [])).toBe(false);
    expect(canTransition("DRAFT", "CANCELLED", [])).toBe(true);
    expect(canTransition("PENDING_APPROVAL", "CANCELLED", none)).toBe(true);
    expect(canTransition("APPROVED", "CANCELLED", none)).toBe(true);
  });
  it("never sets approval states by hand", () => {
    expect(canTransition("DRAFT", "PENDING_APPROVAL", none)).toBe(false);
    expect(canTransition("PENDING_APPROVAL", "APPROVED", none)).toBe(false);
  });
  it("submits drafts with lines", () => {
    expect(canSubmit("DRAFT", none)).toBe(true);
    expect(canSubmit("DRAFT", [])).toBe(false);
    expect(canSubmit("APPROVED", none)).toBe(false);
  });
  it("needs po.issue to issue and po.create to cancel", () => {
    expect(transitionPermission("ISSUED")).toBe("po.issue");
    expect(transitionPermission("CLOSED")).toBe("po.issue");
    expect(transitionPermission("CANCELLED")).toBe("po.create");
  });
  it("follows the workflow order", () => {
    expect(canTransition("ISSUED", "ACKNOWLEDGED", none)).toBe(true);
    expect(canTransition("DRAFT", "ACKNOWLEDGED", none)).toBe(false);
    expect(canTransition("ISSUED", "DELIVERED", none)).toBe(false); // delivery states are derived, never manual
    expect(canTransition("DELIVERED", "CLOSED", all)).toBe(true);
    expect(canTransition("PARTIALLY_DELIVERED", "CLOSED", some)).toBe(true);
  });
  it("blocks cancelling once goods have arrived", () => {
    expect(canTransition("ISSUED", "CANCELLED", none)).toBe(true);
    expect(canTransition("ACKNOWLEDGED", "CANCELLED", some)).toBe(false);
    expect(canTransition("PARTIALLY_DELIVERED", "CANCELLED", some)).toBe(false);
  });
  it("offers nothing on terminal states", () => {
    expect(allowedTransitions("CLOSED", all)).toEqual([]);
    expect(allowedTransitions("CANCELLED", none)).toEqual([]);
  });
  it("describes the short-close balance", () => {
    expect(allowedTransitions("PARTIALLY_DELIVERED", some)[0].label).toBe("Close with 4 units outstanding");
  });
  it("only receives against open, issued orders and edits drafts", () => {
    expect(canReceive("DRAFT")).toBe(false);
    expect(canReceive("ISSUED")).toBe(true);
    expect(canReceive("PARTIALLY_DELIVERED")).toBe(true);
    expect(canReceive("DELIVERED")).toBe(false);
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("ISSUED")).toBe(false);
    expect(isEditable("PENDING_APPROVAL")).toBe(false);
    expect(isEditable("APPROVED")).toBe(false);
    expect(canReceive("APPROVED")).toBe(false);
  });
});
