/**
 * Purchase order workflow. Pure functions.
 *
 *   DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → ACKNOWLEDGED → PARTIALLY_DELIVERED → DELIVERED → CLOSED
 *   any open state → CANCELLED (only while nothing has been received)
 *
 * Submitting (DRAFT → PENDING_APPROVAL) and the approval outcome (→ APPROVED, or back to DRAFT when rejected or
 * withdrawn) go through the approval engine (src/lib/approvals), never through allowedTransitions().
 *
 * Delivery states are never chosen by hand: they are derived from received quantities when goods are received.
 */

export type PoStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ISSUED" | "ACKNOWLEDGED" | "PARTIALLY_DELIVERED" | "DELIVERED" | "CLOSED" | "CANCELLED";
export const PO_STATUSES: PoStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED", "CANCELLED"];
/** The workflow in display order (cancelled shown separately). */
export const PO_WORKFLOW: PoStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"];

export type QtyLine = { quantity: number; receivedQty: number };

export function receivedTotals(lines: QtyLine[]) {
  const ordered = lines.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const received = lines.reduce((s, l) => s + Math.min(Math.max(0, l.receivedQty), Math.max(0, l.quantity)), 0);
  return { ordered, received, outstanding: ordered - received };
}

/** Percentage of ordered units received, 0–100 (0 for an empty PO). */
export function receivedPct(lines: QtyLine[]): number {
  const { ordered, received } = receivedTotals(lines);
  return ordered === 0 ? 0 : Math.round((received / ordered) * 100);
}

/** The delivery state implied by received quantities, or null when nothing has arrived. */
export function deliveryStateFor(lines: QtyLine[]): "PARTIALLY_DELIVERED" | "DELIVERED" | null {
  const { ordered, received } = receivedTotals(lines);
  if (received === 0) return null;
  return received >= ordered ? "DELIVERED" : "PARTIALLY_DELIVERED";
}

/** Status after a goods receipt. Closed and cancelled orders keep their status. */
export function deriveStatusAfterReceipt(current: PoStatus, lines: QtyLine[]): PoStatus {
  if (current === "CLOSED" || current === "CANCELLED") return current;
  return deliveryStateFor(lines) ?? current;
}

/** Goods can be received only against an issued, acknowledged or partially delivered order. */
export function canReceive(status: PoStatus): boolean {
  return status === "ISSUED" || status === "ACKNOWLEDGED" || status === "PARTIALLY_DELIVERED";
}

export type Transition = { to: PoStatus; label: string; tone: "primary" | "secondary" | "danger" };

/** Manual status changes offered to the user. */
export function allowedTransitions(status: PoStatus, lines: QtyLine[]): Transition[] {
  const { received, outstanding } = receivedTotals(lines);
  const cancel: Transition = { to: "CANCELLED", label: "Cancel order", tone: "danger" };
  switch (status) {
    case "DRAFT":
    case "PENDING_APPROVAL":
      return [cancel];
    case "APPROVED":
      return lines.length ? [{ to: "ISSUED", label: "Issue to supplier", tone: "primary" }, cancel] : [cancel];
    case "ISSUED":
      return [{ to: "ACKNOWLEDGED", label: "Mark acknowledged by supplier", tone: "primary" }, ...(received === 0 ? [cancel] : [])];
    case "ACKNOWLEDGED":
      return received === 0 ? [cancel] : [];
    case "PARTIALLY_DELIVERED":
      // Short-close: accept what arrived and close the balance.
      return [{ to: "CLOSED", label: `Close with ${outstanding} unit${outstanding === 1 ? "" : "s"} outstanding`, tone: "secondary" }];
    case "DELIVERED":
      return [{ to: "CLOSED", label: "Close order", tone: "primary" }];
    default:
      return [];
  }
}

export function canTransition(from: PoStatus, to: PoStatus, lines: QtyLine[]): boolean {
  return allowedTransitions(from, lines).some((t) => t.to === to);
}

/** A draft with at least one line can be submitted for approval. */
export function canSubmit(status: PoStatus, lines: QtyLine[]): boolean {
  return status === "DRAFT" && lines.some((l) => l.quantity > 0);
}

/** Who may make a manual status change: issuing and supplier follow-up need po.issue, cancelling needs po.create. */
export function transitionPermission(to: PoStatus): "po.issue" | "po.create" {
  return to === "CANCELLED" ? "po.create" : "po.issue";
}

/** PO lines and header can be edited only while the order is a draft. */
export function isEditable(status: PoStatus): boolean {
  return status === "DRAFT";
}
