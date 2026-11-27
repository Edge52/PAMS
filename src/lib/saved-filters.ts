/**
 * Saved filters (wave 41): which list pages have them, and how a saved query string is cleaned. Pure, so the
 * component, the actions and the tests agree. Stored in table `saved_filters` (src/db/schema-wave41-k.ts).
 */
import type { Permission } from "./auth/permissions";

export type SavedFilterPage = { label: string; need: Permission; paths: string[] };

/** Page key → its label, the permission to open it, and the paths a saved filter may open. */
export const SAVED_FILTER_PAGES = {
  assets: { label: "Asset register", need: "assets.view", paths: ["/assets"] },
  "work-orders": { label: "Work orders", need: "assets.view", paths: ["/assets/work-orders"] },
  ppm: { label: "Planned maintenance", need: "assets.view", paths: ["/assets/maintenance"] },
  requests: { label: "Equipment requests", need: "assets.view", paths: ["/assets/requests"] },
  recalls: { label: "Recalls", need: "assets.view", paths: ["/assets/recalls"] },
  incidents: { label: "Incidents", need: "assets.view", paths: ["/assets/incidents"] },
  offers: { label: "Offers", need: "prices.view", paths: ["/procurement/offers"] },
  rfqs: { label: "RFQs", need: "procurement.view", paths: ["/procurement/rfqs"] },
  "purchase-orders": { label: "Purchase orders", need: "procurement.view", paths: ["/procurement/purchase-orders"] },
  invoices: { label: "Invoices", need: "prices.view", paths: ["/procurement/invoices"] },
  suppliers: { label: "Suppliers", need: "procurement.view", paths: ["/procurement/suppliers"] },
  analytics: {
    label: "Analytics", need: "reports.view",
    paths: ["/analytics", "/analytics/maintenance", "/analytics/cost", "/analytics/procurement", "/analytics/budget", "/analytics/imaging", "/analytics/lifecycle", "/analytics/compare"],
  },
} as const satisfies Record<string, SavedFilterPage>;

export type SavedFilterKey = keyof typeof SAVED_FILTER_PAGES;

export const MAX_SAVED_PER_PAGE = 20;
export const MAX_NAME = 40;
export const MAX_QUERY = 1000;

export const isSavedFilterKey = (k: unknown): k is SavedFilterKey => typeof k === "string" && Object.hasOwn(SAVED_FILTER_PAGES, k);

/** True when `path` is one this page's saved filters may open. */
export function pathAllowed(page: SavedFilterKey, path: string): boolean {
  return (SAVED_FILTER_PAGES[page].paths as readonly string[]).includes(path);
}

/** The query string to keep: no leading "?", no paging, empty values dropped, sorted keys; null when too long. */
export function cleanQuery(query: string): string | null {
  const q = new URLSearchParams(query.replace(/^\?/, ""));
  const out = new URLSearchParams();
  for (const [k, v] of [...q.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (k === "page" || v === "") continue;
    out.append(k, v);
  }
  const s = out.toString();
  return s.length > MAX_QUERY ? null : s;
}

/** A trimmed name with inner spaces collapsed, or null when empty or too long. */
export function cleanName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, " ");
  return n && n.length <= MAX_NAME ? n : null;
}

/** The link a saved filter opens. */
export const savedFilterHref = (path: string, query: string) => (query ? `${path}?${query}` : path);
