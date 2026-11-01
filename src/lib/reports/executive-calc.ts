/** Executive one-page summary: headline figures and the "needs attention" list (pure). */
import type { LiveRow } from "@/components/assets/twin/types";

export type EquipmentFigures = {
  devices: number; inService: number; down: number; availabilityPct: number;
  openJobs: number; overduePpm: number; beyondLife: number; recalls: number; downtimeHours: number; valueEgp: number;
};

export function equipmentFigures(rows: LiveRow[]): EquipmentFigures {
  const f: EquipmentFigures = { devices: rows.length, inService: 0, down: 0, availabilityPct: 100, openJobs: 0, overduePpm: 0, beyondLife: 0, recalls: 0, downtimeHours: 0, valueEgp: 0 };
  for (const [, status, jobs, ppm, life, dt, value, recall] of rows) {
    if (status === "OUT_OF_SERVICE" || status === "UNDER_MAINTENANCE") f.down++;
    if (status === "IN_SERVICE" || status === "INSTALLED") f.inService++;
    f.openJobs += jobs; f.overduePpm += ppm; f.beyondLife += life; f.recalls += recall; f.downtimeHours += dt; f.valueEgp += value;
  }
  const inUse = f.inService + f.down;
  f.availabilityPct = inUse ? Math.round((f.inService / inUse) * 1000) / 10 : 100;
  return f;
}

export type Attention = { level: "high" | "medium"; text: string; href: string };

/** What a director should look at first, worst first, at most `max`. */
export function attentionItems(x: {
  facilityId: number; eq: EquipmentFigures; urgentOpen: number; lateJobs: number; contractsEnding: number; warrantyEnding: number;
  unsupportedUnits: number; latePos: number; pendingApprovals: number;
}, max = 6): Attention[] {
  const out: Attention[] = [];
  const f = x.facilityId;
  if (x.urgentOpen) out.push({ level: "high", text: `${x.urgentOpen} urgent fault${x.urgentOpen === 1 ? "" : "s"} still open`, href: `/assets/work-orders?tab=all&priority=URGENT` });
  if (x.eq.recalls) out.push({ level: "high", text: `${x.eq.recalls} device${x.eq.recalls === 1 ? "" : "s"} under an open recall`, href: "/assets/recalls" });
  if (x.eq.availabilityPct < 95) out.push({ level: "high", text: `Only ${x.eq.availabilityPct} % of equipment in service (${x.eq.down} down)`, href: `/assets?facilityId=${f}&status=OUT_OF_SERVICE` });
  if (x.lateJobs) out.push({ level: "medium", text: `${x.lateJobs} job${x.lateJobs === 1 ? "" : "s"} past the response target`, href: "/assets/work-orders" });
  if (x.eq.overduePpm) out.push({ level: "medium", text: `${x.eq.overduePpm} device${x.eq.overduePpm === 1 ? "" : "s"} overdue for planned maintenance`, href: "/assets/maintenance" });
  if (x.unsupportedUnits) out.push({ level: "medium", text: `${x.unsupportedUnits} unit${x.unsupportedUnits === 1 ? "" : "s"} out of maker support`, href: `/assets/fleet?facilityId=${f}&show=support` });
  if (x.eq.beyondLife) out.push({ level: "medium", text: `${x.eq.beyondLife} device${x.eq.beyondLife === 1 ? "" : "s"} past their service life`, href: "/assets/replacement" });
  if (x.contractsEnding) out.push({ level: "medium", text: `${x.contractsEnding} service contract${x.contractsEnding === 1 ? "" : "s"} ending within 60 days`, href: "/assets/contracts" });
  if (x.latePos) out.push({ level: "medium", text: `${x.latePos} purchase order${x.latePos === 1 ? "" : "s"} past the expected delivery date`, href: "/procurement/purchase-orders" });
  if (x.pendingApprovals) out.push({ level: "medium", text: `${x.pendingApprovals} approval${x.pendingApprovals === 1 ? "" : "s"} waiting`, href: "/approvals" });
  if (x.warrantyEnding) out.push({ level: "medium", text: `${x.warrantyEnding} warrant${x.warrantyEnding === 1 ? "y ends" : "ies end"} within 90 days`, href: `/assets?facilityId=${f}&warranty=expiring` });
  return out.slice(0, max);
}
