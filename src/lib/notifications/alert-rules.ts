/**
 * Which alerts to raise, as pure functions over plain rows (the DB loading lives in ./alerts.ts).
 * Every alert carries a dedupeKey, so running the generator again never repeats an alert; keys include the date the
 * alert is about, so a changed date (validity extended, PO re-dated) raises a fresh one.
 */
import type { Role } from "@/lib/auth/permissions";
import { daysBetween } from "../assets/dates";
import { maintenanceTypeLabel } from "../assets/maintenance";
import type { NewNotification } from "./types";

export type Alert = { role: Role; facilityId: number | null; n: NewNotification };

export type AlertWindows = {
  offerExpiryWarnDays: number;
  warrantyWarnDays: number;
  rfqClosingWarnDays: number;
  /** Open maintenance work orders this many days ahead count as "due". */
  maintenanceDueDays: number;
};

export const MAINTENANCE_DUE_DAYS = 7;
/** Law 182/2018 art. 27: an offer-validity extension request must reach bidders at least 15 days before expiry. */
export const VALIDITY_EXTENSION_NOTICE_DAYS = 15;

const OFFER_CLOSED = new Set(["AWARDED", "REJECTED", "WITHDRAWN"]);
// Not yet with the supplier (draft, in approval, approved but not issued) or finished: no late-delivery alert.
const PO_DONE = new Set(["DRAFT", "PENDING_APPROVAL", "APPROVED", "DELIVERED", "CLOSED", "CANCELLED"]);
const MAINT_OPEN = new Set(["SCHEDULED", "IN_PROGRESS", "OVERDUE"]);

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const inDays = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ── Offers whose validity is running out ── */

export type OfferRow = {
  id: number; reference: string; status: string; validUntil: string | null;
  supplierName: string; projectCode: string; facilityId: number | null;
};

export function offerExpiryAlerts(rows: OfferRow[], today: string, warnDays: number): Alert[] {
  const out: Alert[] = [];
  for (const o of rows) {
    if (!o.validUntil || OFFER_CLOSED.has(o.status)) continue;
    const d = daysBetween(today, o.validUntil);
    if (d < 0 || d > warnDays) continue;
    const urgent = d <= VALIDITY_EXTENSION_NOTICE_DAYS;
    const body = [
      `${o.supplierName}'s offer ${o.reference} for ${o.projectCode} is valid until ${fmt(o.validUntil)}.`,
      urgent
        ? `Law 182/2018 art. 27: a request to extend validity must reach bidders at least ${VALIDITY_EXTENSION_NOTICE_DAYS} days before expiry. ` +
          `This offer is inside that window, so ask for the extension now or decide before it lapses.`
        : `If the evaluation won't finish in time, ask for a validity extension at least ${VALIDITY_EXTENSION_NOTICE_DAYS} days before expiry (Law 182/2018 art. 27).`,
    ].join(" ");
    out.push({
      role: "PROCUREMENT", facilityId: o.facilityId,
      n: {
        kind: "offer_expiring",
        title: `Offer ${o.reference} (${o.supplierName}) expires ${inDays(d)}`,
        body, href: `/procurement/offers/${o.id}`,
        // Two stages: the early warning, then again once inside the art. 27 15-day window.
        dedupeKey: `offer_expiring:${o.id}:${o.validUntil}:${urgent ? "art27" : "warn"}`,
      },
    });
  }
  return out;
}

/* ── RFQs closing soon ── */

export type RfqRow = { id: number; number: string; title: string; status: string; closingDate: string | null; projectId: number; facilityId: number | null };

export function rfqClosingAlerts(rows: RfqRow[], today: string, warnDays: number): Alert[] {
  const out: Alert[] = [];
  for (const r of rows) {
    if (r.status !== "ISSUED" || !r.closingDate) continue;
    const d = daysBetween(today, r.closingDate);
    if (d < 0 || d > warnDays) continue;
    out.push({
      role: "PROCUREMENT", facilityId: r.facilityId,
      n: {
        kind: "rfq_closing",
        title: `${r.number} closes ${inDays(d)}`,
        body: `"${r.title}" closes for offers on ${fmt(r.closingDate)}. Check which invited suppliers haven't responded yet.`,
        href: `/procurement/rfqs/${r.id}`,
        dedupeKey: `rfq_closing:${r.id}:${r.closingDate}`,
      },
    });
  }
  return out;
}

/* ── Purchase orders past their expected delivery ── */

export type PoRow = {
  id: number; number: string; status: string; expectedDelivery: string | null; supplierName: string; facilityId: number | null;
};

export function latePoAlerts(rows: PoRow[], today: string): Alert[] {
  const out: Alert[] = [];
  for (const p of rows) {
    if (!p.expectedDelivery || PO_DONE.has(p.status)) continue;
    const late = daysBetween(p.expectedDelivery, today);
    if (late <= 0) continue;
    out.push({
      role: "PROCUREMENT", facilityId: p.facilityId,
      n: {
        kind: "po_late",
        title: `${p.number} (${p.supplierName}) is ${plural(late, "day")} late`,
        body: `Delivery was expected on ${fmt(p.expectedDelivery)} and the order isn't fully delivered. Chase the supplier or record the delivery.`,
        href: `/procurement/purchase-orders/${p.id}`,
        dedupeKey: `po_late:${p.id}:${p.expectedDelivery}`,
      },
    });
  }
  return out;
}

/* ── Warranties ending ── */

export type WarrantyRow = {
  id: number; assetTag: string; typeName: string; status: string; warrantyEnd: string | null; facilityId: number;
  supplierName: string | null; departmentName: string | null;
};

export function warrantyAlerts(rows: WarrantyRow[], today: string, warnDays: number): Alert[] {
  const out: Alert[] = [];
  for (const a of rows) {
    if (!a.warrantyEnd || a.status === "DISPOSED") continue;
    const d = daysBetween(today, a.warrantyEnd);
    if (d < 0 || d > warnDays) continue;
    const where = a.departmentName ? ` in ${a.departmentName}` : "";
    out.push({
      role: "BIOMEDICAL", facilityId: a.facilityId,
      n: {
        kind: "warranty_ending",
        title: `Warranty on ${a.assetTag} ends ${inDays(d)}`,
        body: `${a.typeName}${where}: warranty ends ${fmt(a.warrantyEnd)}${a.supplierName ? ` (supplier ${a.supplierName})` : ""}. ` +
          `Log any open faults with the supplier now and decide on a service contract.`,
        href: `/assets/${a.id}`,
        dedupeKey: `warranty_ending:${a.id}:${a.warrantyEnd}`,
      },
    });
  }
  return out;
}

/* ── Maintenance work orders due or overdue ── */

export type MaintenanceRow = {
  id: number; assetId: number; assetTag: string; typeName: string; type: string; status: string; scheduledDate: string | null;
  assetStatus: string; facilityId: number; departmentName: string | null;
};

export function maintenanceAlerts(rows: MaintenanceRow[], today: string, dueDays = MAINTENANCE_DUE_DAYS): Alert[] {
  const out: Alert[] = [];
  for (const m of rows) {
    if (!m.scheduledDate || !MAINT_OPEN.has(m.status) || m.assetStatus === "DISPOSED") continue;
    const d = daysBetween(today, m.scheduledDate);
    if (d > dueDays) continue;
    const label = maintenanceTypeLabel(m.type);
    const where = m.departmentName ? `, ${m.departmentName}` : "";
    const overdue = d < 0;
    const n: NewNotification = overdue
      ? {
          kind: "maintenance_overdue",
          title: `${label} overdue: ${m.assetTag}`,
          body: `${m.typeName}${where}: ${label} was scheduled for ${fmt(m.scheduledDate)} (${plural(-d, "day")} ago) and isn't completed.`,
          href: `/assets/${m.assetId}`,
          dedupeKey: `maintenance_overdue:${m.id}`,
        }
      : {
          kind: "maintenance_due",
          title: `${label} due ${inDays(d)}: ${m.assetTag}`,
          body: `${m.typeName}${where}: ${label} is scheduled for ${fmt(m.scheduledDate)}.`,
          href: `/assets/${m.assetId}`,
          dedupeKey: `maintenance_due:${m.id}:${m.scheduledDate}`,
        };
    for (const role of ["BIOMEDICAL", "TECHNICIAN"] as const) out.push({ role, facilityId: m.facilityId, n });
  }
  return out;
}

/* ── Awards whose complaint window has ended without an acceptance notice ── */

export type AwardRow = {
  id: number; reference: string; status: string; complaintUntil: string | null; acceptanceDue: string | null; acceptedOn: string | null;
  supplierName: string; projectCode: string; facilityId: number | null;
};

export function acceptanceNoticeAlerts(rows: AwardRow[], today: string): Alert[] {
  const out: Alert[] = [];
  for (const o of rows) {
    if (o.status !== "AWARDED" || !o.complaintUntil || o.acceptedOn) continue;
    if (o.complaintUntil >= today) continue; // window still open (it runs to the end of that day)
    const due = o.acceptanceDue ? ` It is due by ${fmt(o.acceptanceDue)}${o.acceptanceDue < today ? " — that date has passed" : ""}.` : "";
    out.push({
      role: "PROCUREMENT", facilityId: o.facilityId,
      n: {
        kind: "acceptance_notice_due",
        title: `Send the acceptance notice to ${o.supplierName} (${o.projectCode})`,
        body: `The complaint window on the award of offer ${o.reference} ended on ${fmt(o.complaintUntil)}. ` +
          `Under Law 182/2018 art. 39 the winning bidder must now be notified of acceptance.${due}`,
        href: `/procurement/offers/${o.id}`,
        dedupeKey: `acceptance_notice_due:${o.id}:${o.complaintUntil}`,
      },
    });
  }
  return out;
}

/* ── Service contracts ending (wave 3): biomedical and procurement decide to renew or re-tender ── */

export type ContractRow = { id: number; number: string; title: string; endDate: string; facilityId: number; supplierName: string; devices: number };
/** Contracts get a longer warning than warranties: renewing or re-tendering takes time. */
export const CONTRACT_WARN_DAYS = 60;

export function contractAlerts(rows: ContractRow[], today: string, warnDays = CONTRACT_WARN_DAYS): Alert[] {
  const out: Alert[] = [];
  for (const c of rows) {
    const d = daysBetween(today, c.endDate);
    if (d < 0 || d > warnDays) continue;
    const n = {
      kind: "contract_ending",
      title: `Service contract ${c.number} ends ${inDays(d)}`,
      body: `${c.title} with ${c.supplierName} covers ${plural(c.devices, "device")} and ends ${fmt(c.endDate)}. Renew it or start a new tender.`,
      href: `/assets/contracts/${c.id}`,
      dedupeKey: `contract_ending:${c.id}:${c.endDate}`,
    };
    out.push({ role: "BIOMEDICAL", facilityId: c.facilityId, n }, { role: "PROCUREMENT", facilityId: c.facilityId, n });
  }
  return out;
}

export type AlertData = {
  offers: OfferRow[]; rfqs: RfqRow[]; pos: PoRow[]; warranties: WarrantyRow[]; maintenance: MaintenanceRow[]; awards: AwardRow[];
  contracts?: ContractRow[];
};

export function collectAlerts(data: AlertData, today: string, w: AlertWindows): Alert[] {
  return [
    ...offerExpiryAlerts(data.offers, today, w.offerExpiryWarnDays),
    ...rfqClosingAlerts(data.rfqs, today, w.rfqClosingWarnDays),
    ...latePoAlerts(data.pos, today),
    ...acceptanceNoticeAlerts(data.awards, today),
    ...warrantyAlerts(data.warranties, today, w.warrantyWarnDays),
    ...maintenanceAlerts(data.maintenance, today, w.maintenanceDueDays),
    ...contractAlerts(data.contracts ?? [], today),
  ];
}

/* ── Summaries: many per-asset alerts of one kind become one notification ── */

/** More than this many warranty/maintenance alerts of one kind for one facility are sent as one summary instead. */
export const DIGEST_THRESHOLD = 3;

const DIGEST_KINDS: Record<string, { word: (n: number) => string; href: (facilityId: number | null, w: AlertWindows) => string }> = {
  warranty_ending: {
    word: (n) => `${plural(n, "warranty")} end within the warning window`.replace("warrantys", "warranties"),
    href: (f, w) => `/reports/warranty-expiries?days=${w.warrantyWarnDays}${f ? `&facilityId=${f}` : ""}`,
  },
  maintenance_overdue: { word: (n) => `${plural(n, "maintenance job")} overdue`, href: () => "/assets/maintenance?tab=due" },
  maintenance_due: { word: (n) => `${plural(n, "maintenance job")} due this week`, href: () => "/assets/maintenance?tab=due" },
};

/** ISO week label (2026-W44): summaries repeat at most weekly for warranties and daily for maintenance. */
export function isoWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Collapse large groups (same role, facility and kind) into one summary notification that links to the list, so a
 * biomedical engineer gets "40 warranties end…" once a week instead of 40 separate alerts. Small groups pass through.
 */
export function digestAlerts(alerts: Alert[], today: string, w: AlertWindows, facilityName: (id: number | null) => string | null = () => null): Alert[] {
  const groups = new Map<string, Alert[]>();
  const out: Alert[] = [];
  for (const a of alerts) {
    if (!DIGEST_KINDS[a.n.kind]) { out.push(a); continue; }
    const k = `${a.role}|${a.facilityId ?? "*"}|${a.n.kind}`;
    const g = groups.get(k);
    if (g) g.push(a); else groups.set(k, [a]);
  }
  for (const g of groups.values()) {
    if (g.length <= DIGEST_THRESHOLD) { out.push(...g); continue; }
    const { role, facilityId, n } = g[0];
    const def = DIGEST_KINDS[n.kind];
    const where = facilityName(facilityId);
    const period = n.kind === "warranty_ending" ? isoWeek(today) : today;
    const examples = g.slice(0, 3).map((a) => a.n.title).join("; ");
    out.push({
      role, facilityId,
      n: {
        kind: n.kind,
        title: `${def.word(g.length)}${where ? ` at ${where}` : ""}`,
        body: `For example: ${examples}${g.length > 3 ? `; and ${g.length - 3} more` : ""}. Open the list to see them all.`,
        href: def.href(facilityId, w),
        dedupeKey: `${n.kind}_digest:${facilityId ?? "all"}:${period}`,
      },
    });
  }
  return out;
}
