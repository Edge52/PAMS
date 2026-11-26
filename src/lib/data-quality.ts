/**
 * Data quality rules (wave 39). Pure: the page loads compact rows (bounded) and these functions say which records break
 * which rule, how serious it is, and each hospital's score. Change a rule here, with its test.
 *
 * Score per hospital = share of its devices (not disposed) that pass every high and medium device rule.
 */
import { nextPpmDue } from "./assets/maintenance";

export type Severity = "high" | "medium" | "low";
export type DqEntity = "asset" | "work_order" | "po" | "offer" | "contract";

export type DqAsset = {
  id: number; facilityId: number; tag: string; status: string; condition: string | null;
  serial: string | null; manufacturer: string | null; model: string | null;
  installDate: string | null; purchaseDate: string | null; purchaseCost: string | number | null;
  roomId: number | null; criticality: string | null; gmdnCode: string | null;
  ppmIntervalMonths: number | null; strategy: string | null;
  /** completedDate of the last completed PPM visit. */
  lastPpm: string | null;
  /** A PPM visit is scheduled, in progress or overdue (planned, not done). */
  ppmPlanned: boolean;
  /** The device has an open work order. */
  openJob: boolean;
};

export type DqWorkOrder = {
  id: number; facilityId: number; number: string; status: string; reportedAt: string;
  laborHours: number | null; deviceDown: boolean; downtimeStart: string | null; downtimeEnd: string | null;
};

export type DqPo = { id: number; facilityId: number | null; number: string; status: string; lastDelivery: string | null; invoiced: boolean };
export type DqOffer = { id: number; facilityId: number | null; reference: string; currency: string | null; status: string };
export type DqContract = { id: number; facilityId: number; number: string; endDate: string; assetIds: number[] };

export type DqData = {
  assets: DqAsset[]; workOrders: DqWorkOrder[]; pos: DqPo[]; offers: DqOffer[]; contracts: DqContract[];
  /** Currencies with a stored rate to EGP. */
  rated: Set<string>;
  /** Devices covered today by a running contract. */
  coveredNow: Set<number>;
};

type RuleBase = { id: string; title: string; severity: Severity; fix: string };
export type AssetRule = RuleBase & { entity: "asset"; test: (a: DqAsset, ctx: { today: string; dupes: Set<number> }) => boolean };
export type OtherRule = RuleBase & { entity: Exclude<DqEntity, "asset">; find: (d: DqData, today: string) => { id: number; facilityId: number | null; label: string }[] };
export type DqRule = AssetRule | OtherRule;

export const OPEN_JOB_DAYS = 90;
export const INVOICE_DAYS = 60;
export const PPM_SOON_DAYS = 30;

const blank = (s: string | null | undefined) => !s || !s.trim();
const live = (a: DqAsset) => a.status !== "DISPOSED";
const inUse = (a: DqAsset) => live(a) && a.status !== "IN_STOCK" && a.status !== "ON_LOAN";
const DONE = new Set(["COMPLETED", "CLOSED"]);
const OPEN = new Set(["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]);

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Serials are compared without case, spaces or dashes. */
export function serialKey(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[\s\-_/.]/g, "");
}

/** Ids of devices (not disposed) that share a serial number with another device of the same maker. */
export function duplicateSerials(assets: DqAsset[]): Set<number> {
  const groups = new Map<string, number[]>();
  for (const a of assets) {
    if (!live(a)) continue;
    const k = serialKey(a.serial);
    if (!k) continue;
    const key = `${(a.manufacturer ?? "").trim().toLowerCase()}|${k}`;
    groups.set(key, [...(groups.get(key) ?? []), a.id]);
  }
  const out = new Set<number>();
  for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) out.add(id);
  return out;
}

/** PPM is due (or due within PPM_SOON_DAYS) and no visit is planned. */
export function ppmDueUnplanned(a: DqAsset, today: string): boolean {
  if (!inUse(a) || a.ppmPlanned) return false;
  const next = nextPpmDue({ id: a.id, status: a.status, installDate: a.installDate, purchaseDate: a.purchaseDate,
    ppmIntervalMonths: a.ppmIntervalMonths, maintenanceStrategy: a.strategy, lastPpmDate: a.lastPpm });
  return !!next.due && next.due <= addDays(today, PPM_SOON_DAYS);
}

export const ASSET_RULES: AssetRule[] = [
  { id: "no-serial", entity: "asset", title: "Devices without a serial number", severity: "high",
    fix: "Read it from the label and add it on the device page.", test: (a) => live(a) && blank(a.serial) },
  { id: "no-make-model", entity: "asset", title: "Devices without a maker or model", severity: "high",
    fix: "Add the maker and model; pick them from the catalogue list.", test: (a) => live(a) && (blank(a.manufacturer) || blank(a.model)) },
  { id: "no-install-date", entity: "asset", title: "Devices in use without an install date", severity: "medium",
    fix: "Add the install date (PPM and depreciation count from it).", test: (a) => inUse(a) && !a.installDate },
  { id: "no-cost", entity: "asset", title: "Devices without a purchase cost", severity: "medium",
    fix: "Add the cost and currency from the order or invoice.", test: (a) => live(a) && (a.purchaseCost == null || a.purchaseCost === "") },
  { id: "no-room", entity: "asset", title: "Devices in use without a room", severity: "medium",
    fix: "Move the device to its room.", test: (a) => inUse(a) && a.roomId == null },
  { id: "no-criticality", entity: "asset", title: "Devices without a criticality", severity: "medium",
    fix: "Set it on the device, or on its device type in the catalogue.", test: (a) => live(a) && !a.criticality },
  { id: "no-gmdn", entity: "asset", title: "Devices whose type has no GMDN code", severity: "low",
    fix: "Add the GMDN code to the device type in the catalogue.", test: (a) => live(a) && blank(a.gmdnCode) },
  { id: "ppm-unplanned", entity: "asset", title: "PPM due but no visit planned", severity: "high",
    fix: "Plan the visit, or record the last one if it was done.", test: (a, c) => ppmDueUnplanned(a, c.today) },
  { id: "duplicate-serial", entity: "asset", title: "Serial number used by more than one device", severity: "high",
    fix: "Check both labels; one of the records is wrong or a duplicate.", test: (a, c) => c.dupes.has(a.id) },
  { id: "down-no-job", entity: "asset", title: "Out of service with no open work order", severity: "high",
    fix: "Open a work order, or put the device back in service.",
    test: (a) => a.status === "OUT_OF_SERVICE" && a.condition !== "CONDEMNED" && !a.openJob },
];

export const OTHER_RULES: OtherRule[] = [
  { id: "job-no-labour", entity: "work_order", title: "Finished jobs without labour hours", severity: "low",
    fix: "Add the hours worked, so cost and workload reports count them.",
    find: (d) => d.workOrders.filter((w) => DONE.has(w.status) && !(w.laborHours && w.laborHours > 0)).map((w) => ({ id: w.id, facilityId: w.facilityId, label: w.number })) },
  { id: "job-no-downtime", entity: "work_order", title: "Finished device-down jobs without downtime times", severity: "medium",
    fix: "Add when the device went down and came back, for uptime figures.",
    find: (d) => d.workOrders.filter((w) => DONE.has(w.status) && w.deviceDown && (!w.downtimeStart || !w.downtimeEnd)).map((w) => ({ id: w.id, facilityId: w.facilityId, label: w.number })) },
  { id: "job-old-open", entity: "work_order", title: `Work orders open more than ${OPEN_JOB_DAYS} days`, severity: "medium",
    fix: "Finish, put on hold with a reason, or cancel the job.",
    find: (d, today) => d.workOrders.filter((w) => OPEN.has(w.status) && w.reportedAt.slice(0, 10) < addDays(today, -OPEN_JOB_DAYS)).map((w) => ({ id: w.id, facilityId: w.facilityId, label: w.number })) },
  { id: "po-no-invoice", entity: "po", title: `Orders received ${INVOICE_DAYS}+ days ago with no invoice`, severity: "medium",
    fix: "Record the supplier's invoice, or ask the supplier for it.",
    find: (d, today) => d.pos.filter((p) => ["PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"].includes(p.status) && !p.invoiced && !!p.lastDelivery && p.lastDelivery < addDays(today, -INVOICE_DAYS))
      .map((p) => ({ id: p.id, facilityId: p.facilityId, label: p.number })) },
  { id: "offer-no-rate", entity: "offer", title: "Offers with no currency or no exchange rate", severity: "medium",
    fix: "Set the offer's currency, or add the rate under Exchange rates.",
    find: (d) => d.offers.filter((o) => o.status !== "WITHDRAWN" && (blank(o.currency) || (o.currency !== "EGP" && !d.rated.has(o.currency!))))
      .map((o) => ({ id: o.id, facilityId: o.facilityId, label: o.reference })) },
  { id: "contract-expired-linked", entity: "contract", title: "Expired contracts still linked to devices in use", severity: "low",
    fix: "Renew the contract, or link the devices to the new one.",
    find: (d, today) => {
      const live = new Set(d.assets.filter((a) => a.status !== "DISPOSED").map((a) => a.id));
      return d.contracts.filter((c) => c.endDate < today && c.assetIds.some((id) => live.has(id) && !d.coveredNow.has(id)))
        .map((c) => ({ id: c.id, facilityId: c.facilityId, label: c.number }));
    } },
];

export const RULES: DqRule[] = [...ASSET_RULES, ...OTHER_RULES];
export const findRule = (id: string): DqRule | undefined => RULES.find((r) => r.id === id);

export type Hit = { id: number; facilityId: number | null; label: string };
export type RuleResult = { rule: DqRule; hits: Hit[] };

/** Every rule with the records that break it. `skip` leaves rules out (e.g. offers for people who can't see prices). */
export function evaluate(d: DqData, today: string, skip: (r: DqRule) => boolean = () => false): RuleResult[] {
  const dupes = duplicateSerials(d.assets);
  return RULES.filter((r) => !skip(r)).map((rule) => ({
    rule,
    hits: rule.entity === "asset"
      ? d.assets.filter((a) => rule.test(a, { today, dupes })).map((a) => ({ id: a.id, facilityId: a.facilityId, label: a.tag }))
      : rule.find(d, today),
  }));
}

export type HospitalScore = { facilityId: number; devices: number; clean: number; pct: number | null };

/** Device rules that count towards the score: high and medium only (low ones, e.g. catalogue GMDN codes, are listed but not scored). */
export const SCORED_RULES = ASSET_RULES.filter((r) => r.severity !== "low");

/** Per hospital: devices (not disposed) and how many pass every high and medium device rule. */
export function hospitalScores(assets: DqAsset[], today: string): HospitalScore[] {
  const dupes = duplicateSerials(assets);
  const by = new Map<number, HospitalScore>();
  for (const a of assets) {
    if (!live(a)) continue;
    const s = by.get(a.facilityId) ?? { facilityId: a.facilityId, devices: 0, clean: 0, pct: null };
    s.devices++;
    if (!SCORED_RULES.some((r) => r.test(a, { today, dupes }))) s.clean++;
    by.set(a.facilityId, s);
  }
  return [...by.values()].map((s) => ({ ...s, pct: s.devices ? Math.round((s.clean / s.devices) * 1000) / 10 : null }))
    .sort((a, b) => a.facilityId - b.facilityId);
}

const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
/** Most serious first, then most records. */
export function sortResults(rs: RuleResult[]): RuleResult[] {
  return [...rs].sort((a, b) => SEV_ORDER[a.rule.severity] - SEV_ORDER[b.rule.severity] || b.hits.length - a.hits.length);
}

export const ENTITY_LABEL: Record<DqEntity, string> = { asset: "Devices", work_order: "Work orders", po: "Orders", offer: "Offers", contract: "Contracts" };

/** Link to one record. */
export function recordHref(entity: DqEntity, id: number): string {
  switch (entity) {
    case "asset": return `/assets/${id}`;
    case "work_order": return `/assets/work-orders/${id}`;
    case "po": return `/procurement/purchase-orders/${id}`;
    case "offer": return `/procurement/offers/${id}`;
    case "contract": return `/assets/contracts/${id}`;
  }
}
