/**
 * Service contracts and warranty cover. Pure — shared by the contract pages, the asset page, work orders and tests.
 */
import { daysBetween } from "./dates";

export const CONTRACT_TYPES = ["FULL_SERVICE", "PREVENTIVE", "PARTS_ONLY", "LABOUR_ONLY", "WARRANTY_EXTENSION"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const CLAIM_STATUSES = ["NOT_CLAIMED", "SUBMITTED", "ACCEPTED", "REJECTED"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  FULL_SERVICE: "Full service (parts, labour, PPM)",
  PREVENTIVE: "Preventive maintenance only",
  PARTS_ONLY: "Parts only",
  LABOUR_ONLY: "Labour only",
  WARRANTY_EXTENSION: "Extended warranty",
};

/** Contracts ending within this many days are "expiring" (time to renew or re-tender). */
export const CONTRACT_RENEWAL_DAYS = 60;

export type ContractState = "FUTURE" | "ACTIVE" | "EXPIRING" | "EXPIRED";

export function contractState(c: { startDate: string; endDate: string }, today: string, soonDays = CONTRACT_RENEWAL_DAYS): { state: ContractState; days: number } {
  if (today < c.startDate) return { state: "FUTURE", days: daysBetween(today, c.startDate) };
  const days = daysBetween(today, c.endDate);
  if (days < 0) return { state: "EXPIRED", days };
  return { state: days <= soonDays ? "EXPIRING" : "ACTIVE", days };
}

export type CoverContract = { id: number; number: string; type: string; startDate: string; endDate: string; supplierName?: string | null; responseHours?: number | null; includesParts?: boolean };
export type Cover =
  | { kind: "WARRANTY"; until: string }
  | { kind: "CONTRACT"; contract: CoverContract }
  | { kind: "NONE" };

/**
 * What covers a repair on `date`: the manufacturer's warranty first (it costs the hospital nothing), then the
 * running contract that ends last (full service preferred over partial cover when both run).
 */
export function coverOn(asset: { warrantyEnd?: string | null }, contracts: CoverContract[], date: string): Cover {
  if (asset.warrantyEnd && date <= asset.warrantyEnd) return { kind: "WARRANTY", until: asset.warrantyEnd };
  const rank = (t: string) => (t === "FULL_SERVICE" || t === "WARRANTY_EXTENSION" ? 0 : 1);
  const running = contracts.filter((c) => c.startDate <= date && date <= c.endDate)
    .sort((a, b) => rank(a.type) - rank(b.type) || b.endDate.localeCompare(a.endDate));
  return running[0] ? { kind: "CONTRACT", contract: running[0] } : { kind: "NONE" };
}

/** Plain words for a cover, e.g. on the work order page. */
export function coverLabel(c: Cover): string {
  if (c.kind === "WARRANTY") return `Under the manufacturer's warranty until ${c.until}`;
  if (c.kind === "CONTRACT") return `Covered by ${c.contract.number}${c.contract.supplierName ? ` with ${c.contract.supplierName}` : ""} until ${c.contract.endDate}`;
  return "No warranty or service contract";
}

/** Contract value per covered asset per year — used to compare with in-house repair cost. */
export function annualCostPerAsset(value: number | null | undefined, startDate: string, endDate: string, assets: number): number | null {
  if (value == null || assets <= 0) return null;
  const years = Math.max(1 / 12, (daysBetween(startDate, endDate) + 1) / 365.25);
  return value / years / assets;
}
