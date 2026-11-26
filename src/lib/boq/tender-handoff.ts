/**
 * BOQ → tender handoff (wave 39). Pure: which BOQ lines go into a new RFQ, how they become RFQ items (one per device
 * type, quantities added up, the BOQ line ids kept so the BOQ can show plan vs ordered), and the plan vs ordered sums.
 */

export type HandoffLine = {
  id: number; deviceTypeId: number; deviceCode: string; deviceName: string; quantity: number; department: string | null;
};

export type RfqItem = {
  deviceTypeId: number; code: string; name: string; quantity: number; boqLineIds: number[]; departments: string[]; sortOrder: number;
};

/** Lines ticked one by one, plus every line of a ticked group (device type). Unknown ids are ignored. */
export function pickLines<L extends HandoffLine>(lines: L[], lineIds: number[], groupIds: number[] = []): L[] {
  const ids = new Set(lineIds), groups = new Set(groupIds);
  return lines.filter((l) => ids.has(l.id) || groups.has(l.deviceTypeId));
}

/**
 * RFQ items from BOQ lines: one per device type (an RFQ has one line per type), quantities added, departments listed
 * once in BOQ order. Lines with no quantity are left out. Sorted by device code.
 */
export function toRfqItems(lines: HandoffLine[]): RfqItem[] {
  const by = new Map<number, Omit<RfqItem, "sortOrder">>();
  for (const l of lines) {
    if (!(l.quantity > 0)) continue;
    const it = by.get(l.deviceTypeId) ?? { deviceTypeId: l.deviceTypeId, code: l.deviceCode, name: l.deviceName, quantity: 0, boqLineIds: [], departments: [] };
    it.quantity += l.quantity;
    it.boqLineIds.push(l.id);
    if (l.department && !it.departments.includes(l.department)) it.departments.push(l.department);
    by.set(l.deviceTypeId, it);
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code)).map((it, i) => ({ ...it, sortOrder: i }));
}

/** BOQ line id → the RFQ numbers that already ask for it (RFQs not cancelled). */
export function tenderedLines(rfqLines: { rfqNumber: string; boqLineIds: number[] }[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const r of rfqLines) for (const id of r.boqLineIds) {
    const list = out.get(id) ?? [];
    if (!list.includes(r.rfqNumber)) list.push(r.rfqNumber);
    out.set(id, list);
  }
  return out;
}

export type OrderedLine = { boqLineId: number | null; deviceTypeId: number; quantity: number; received: number };

export type PlanRow = {
  deviceTypeId: number; code: string; name: string;
  planned: number; inTender: number; ordered: number; received: number; toOrder: number; rfqs: string[];
};

/**
 * Plan vs ordered per device type. `ordered` = live PO lines from this BOQ's tenders: lines whose offer line points at
 * a BOQ line count for that line's type; the rest count by their device type. To order = planned − ordered (never < 0).
 */
export function planVsOrdered(lines: HandoffLine[], tendered: Map<number, string[]>, ordered: OrderedLine[]): PlanRow[] {
  const typeOfLine = new Map(lines.map((l) => [l.id, l.deviceTypeId]));
  const by = new Map<number, PlanRow>();
  const row = (deviceTypeId: number, code = "?", name = `Device #${deviceTypeId}`) => {
    let r = by.get(deviceTypeId);
    if (!r) { r = { deviceTypeId, code, name, planned: 0, inTender: 0, ordered: 0, received: 0, toOrder: 0, rfqs: [] }; by.set(deviceTypeId, r); }
    return r;
  };
  for (const l of lines) {
    const r = row(l.deviceTypeId, l.deviceCode, l.deviceName);
    r.planned += l.quantity;
    const rfqs = tendered.get(l.id);
    if (rfqs?.length) {
      r.inTender += l.quantity;
      for (const n of rfqs) if (!r.rfqs.includes(n)) r.rfqs.push(n);
    }
  }
  for (const o of ordered) {
    const t = (o.boqLineId != null ? typeOfLine.get(o.boqLineId) : undefined) ?? o.deviceTypeId;
    if (!by.has(t)) continue; // not a type this BOQ plans
    const r = row(t);
    r.ordered += o.quantity;
    r.received += o.received;
  }
  return [...by.values()].filter((r) => r.planned > 0 || r.ordered > 0)
    .map((r) => ({ ...r, toOrder: Math.max(0, r.planned - r.ordered), rfqs: r.rfqs.sort() }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** One sentence about tendering this BOQ, the same wherever it is shown. */
export function tenderHint(p: { project: { code: string } | null; status: string }): string {
  const approval = p.status === "APPROVED" ? "" : " The BOQ is not approved yet: quantities are copied when the RFQ is made, so approve it first if the RFQ is going out.";
  return (p.project
    ? `Linked to ${p.project.code}. Start a tender to pick lines for a new RFQ in that project, or another one.`
    : "Not linked to a project yet. Starting a tender creates the project, links this BOQ to it and makes the RFQ.") + approval;
}
