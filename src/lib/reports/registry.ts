import "server-only";
import { formatDate, todayISO } from "@/lib/format";
import { assetsByDepartmentReport } from "./assets-by-department";
import { DEFAULT_PPM_GRACE_DAYS, DEFAULT_WARRANTY_DAYS, parseReportFilters } from "./calc";
import { ppmComplianceReport } from "./ppm-compliance";
import { openPurchaseOrdersReport } from "./purchase-orders";
import { tenderStatusReport } from "./tenders";
import type { FilterKind, ReportContext, ReportFilters, ReportResult } from "./types";
import { warrantyExpiryReport } from "./warranty";
import { workOrdersReport } from "./work-orders";
import { incidentsReport } from "./incidents";
import { deviceSecurityReport } from "./device-security";
import { bookValueReport } from "./book-value";
import { serviceCostReport } from "./service-cost";

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
  {
    slug: "work-orders", title: "Work orders and response times",
    description: "Jobs reported in the period by priority and by department: still open, answered within the target, and typical times to answer and to fix.",
    filters: ["facility", "dateRange"], dateLabel: "Reported",
    defaults: (today) => ({ from: today.slice(0, 4) + "-01-01", to: today }),
    load: workOrdersReport,
  },
  {
    slug: "incidents", title: "Device incidents",
    description: "Incidents in the period with the harm done, and whether the maker and the Egyptian Drug Authority were told in time.",
    filters: ["facility", "dateRange"], dateLabel: "Happened",
    defaults: (today) => ({ from: today.slice(0, 4) + "-01-01", to: today }),
    load: incidentsReport,
  },
  {
    slug: "device-security", title: "Device security",
    description: "Devices on the network or holding patient data, with what needs attention: operating system out of support, factory passwords, no recent update.",
    filters: ["facility"],
    load: deviceSecurityReport,
  },
  {
    slug: "book-value", title: "Book value",
    description: "What the equipment cost, how much has been written off (straight line) and its book value today, by facility, department and device type.",
    filters: ["facility"],
    load: bookValueReport,
  },
  {
    slug: "service-cost", title: "Service cost and COSR",
    description: "Maintenance, repair and contract cost in the period against what the devices cost to buy (COSR), by device type, department and supplier, in-house and contract.",
    filters: ["facility", "dateRange"], dateLabel: "Period",
    defaults: (today) => ({ from: today.slice(0, 4) + "-01-01", to: today }),
    load: serviceCostReport,
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
