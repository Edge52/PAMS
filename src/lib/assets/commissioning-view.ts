/** How the commissioning plan page is split up (wave 27): tabs, and rooms a page at a time. Pure. */
export const PLAN_TABS = [
  { key: "overview", label: "Progress", edit: false },
  { key: "rooms", label: "Rooms", edit: false },
  { key: "dates", label: "Dates for a group", edit: true },
  { key: "settings", label: "Plan settings", edit: true },
] as const;
export type PlanTab = (typeof PLAN_TABS)[number]["key"];

/** Rooms in the table at once: 25 rooms is about 125 fields. */
export const ROOMS_PER_PAGE = 25;

/** The page of `total` rooms to show: page numbers start at 1 and are kept in range. */
export function pageOf(total: number, page: number, size = ROOMS_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const n = Number.isInteger(page) ? Math.min(Math.max(page, 1), pages) : 1;
  return { page: n, pages, from: (n - 1) * size, to: Math.min(n * size, total) };
}
