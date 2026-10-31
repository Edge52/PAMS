import "server-only";
import { formatDate, todayISO } from "@/lib/format";
import { assetsByDepartmentReport } from "./assets-by-department";
import { DEFAULT_PPM_GRACE_DAYS, DEFAULT_WARRANTY_DAYS, parseReportFilters } from "./calc";
import { ppmComplianceReport } from "./ppm-compliance";
import { openPurchaseOrdersReport } from "./purchase-orders";
import { tenderStatusReport } from "./tenders";
import type { FilterKind, ReportContext, ReportFilters, ReportResult } from "./types";
import { warrantyExpiryReport } from "./warranty";

export type ReportDef = {
  slug: string;
  title: string;
  description: string;
  filters: FilterKind[];
  /** Label for the date range filter, when the report has one. */
  dateLabel?: string;
  defaults?: (today: string) => Partial<ReportFilters>;
  load: (ctx: ReportContext) => Promise<ReportResult>;
};

export const REPORTS: ReportDef[] = [
  {
    slug: "tender-status", title: "Tender status",
    description: "Every project with its client, deadline, RFQs and offers, and where the award stands — including the complaint window and acceptance notice.",
    filters: ["facility", "projectStatus", "dateRange"], dateLabel: "Submission deadline",
    load: tenderStatusReport,
  },
  {
    slug: "open-purchase-orders", title: "Open purchase orders",
    description: "Orders not yet delivered or closed: value in their own currency and in EGP, quantities ordered and received, and how late each one is.",
    filters: ["facility", "dateRange"], dateLabel: "Expected delivery",
    load: openPurchaseOrdersReport,
  },
  {
    slug: "assets-by-department", title: "Assets by department",
    description: "Equipment counts for each facility and department by status and by category, with total purchase cost.",
    filters: ["facility"],
    load: assetsByDepartmentReport,
  },
  {
    slug: "warranty-expiries", title: "Warranty expiries",
    description: "Assets whose warranty ends in the chosen window, with the supplier to contact.",
    filters: ["facility", "days"], defaults: () => ({ days: DEFAULT_WARRANTY_DAYS }),
    load: warrantyExpiryReport,
  },
  {
    slug: "ppm-compliance", title: "PPM compliance",
    description: "For each department: planned preventive maintenance due in the period, done on time, done late, overdue and never scheduled.",
    filters: ["facility", "dateRange", "grace"], dateLabel: "Scheduled",
    defaults: (today) => ({ from: today.slice(0, 4) + "-01-01", to: today, grace: DEFAULT_PPM_GRACE_DAYS }),
    load: ppmComplianceReport,
  },
];

export function findReport(slug: string): ReportDef | undefined {
  return REPORTS.find((r) => r.slug === slug);
}

/** Human lines describing the filters in effect (print header and Excel). */
export function describeFilters(def: ReportDef, f: ReportFilters, facility: string | null): string[] {
  const out: string[] = [];
  const d = (iso: string) => formatDate(iso);
  if (def.filters.includes("facility")) out.push(`Facility: ${facility ?? "all facilities you can see"}`);
  if (def.filters.includes("projectStatus")) out.push(f.projectStatus === "all" ? "Projects: all, including closed" : "Projects: open");
  if (def.filters.includes("dateRange") && (f.from || f.to)) {
    out.push(`${def.dateLabel ?? "Dates"}: ${f.from ? d(f.from) : "any"} to ${f.to ? d(f.to) : "any"}`);
  }
  if (def.filters.includes("days")) out.push(`Window: next ${f.days} days`);
  if (def.filters.includes("grace")) out.push(`On time: within ${f.grace} day${f.grace === 1 ? "" : "s"} of the scheduled date`);
  return out;
}

export function reportFilters(def: ReportDef, params: URLSearchParams | Record<string, string | string[] | undefined>, today = todayISO()): ReportFilters {
  return parseReportFilters(params, def.defaults?.(today) ?? {});
}
