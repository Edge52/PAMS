import "server-only";
import { formatDate, todayISO } from "@/lib/format";
import { assetsByDepartmentReport } from "./assets-by-department";
import { DEFAULT_PPM_GRACE_DAYS, DEFAULT_WARRANTY_DAYS, parseReportFilters } from "./calc";
import { ppmComplianceReport } from "./ppm-compliance";
import { openPurchaseOrdersReport } from "./purchase-orders";
import { tenderStatusReport } from "./tenders";
import type { FilterKind, ReportContext, ReportFilters, ReportResult } from "./types";
import type { Permission } from "@/lib/auth/permissions";
import { warrantyExpiryReport } from "./warranty";
import { workOrdersReport } from "./work-orders";
import { incidentsReport } from "./incidents";
import { deviceSecurityReport } from "./device-security";
import { depreciationJournalReport } from "./depreciation-journal";
import { bookValueReport } from "./book-value";
import { serviceCostReport } from "./service-cost";
import { calibrationReport } from "./calibration";
import { electricalSafetyReport } from "./electrical-safety";
import { recallsReport } from "./recalls";
import { userTrainingReport } from "./user-training";
import { gaharReport } from "./gahar";

export type ReportDef = {
  slug: string;
  title: string;
  description: string;
  filters: FilterKind[];
  /** Label for the date range filter, when the report has one. */
  dateLabel?: string;
  defaults?: (today: string) => Partial<ReportFilters>;
  load: (ctx: ReportContext) => Promise<ReportResult>;
  /** Extra permission beyond reports.view (audit R9: order values are for those who may see prices). */
  need?: Permission;
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
    filters: ["facility", "dateRange"], dateLabel: "Expected delivery", need: "prices.view",
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
    description: "What the equipment cost, how much has been written off and its book value today, by facility, department and device type.",
    filters: ["facility"],
    load: bookValueReport,
  },
  {
    slug: "depreciation-journal", title: "Depreciation journal",
    description: "Each device's depreciation charge for the period as journal lines (debit expense, credit accumulated depreciation), ready to import into the finance system from Excel.",
    filters: ["facility", "dateRange"], dateLabel: "Period",
    defaults: (today) => ({ from: `${today.slice(0, 7)}-01`, to: today }),
    load: depreciationJournalReport,
  },
  {
    slug: "service-cost", title: "Service cost and COSR",
    description: "Maintenance, repair and contract cost in the period against what the devices cost to buy (COSR), by device type, department and supplier, in-house and contract.",
    filters: ["facility", "dateRange"], dateLabel: "Period",
    defaults: (today) => ({ from: today.slice(0, 4) + "-01-01", to: today }),
    load: serviceCostReport,
  },
  // Wave 40: the standard reports GAHAR surveyors ask for, and the evidence pack.
  {
    slug: "calibration", title: "Calibration",
    description: "Devices that need calibration by department: in date, due, overdue, failed and never calibrated, with calibrations done in the period and the share done on time.",
    filters: ["facility", "dateRange"], dateLabel: "Calibrated",
    defaults: (today) => ({ from: today.slice(0, 4) + "-01-01", to: today }),
    load: calibrationReport,
  },
  {
    slug: "electrical-safety", title: "Electrical safety tests",
    description: "Tests done and failed in the period by IEC 62353 protection class, and devices whose last test failed or is overdue.",
    filters: ["facility", "dateRange"], dateLabel: "Tested",
    defaults: (today) => ({ from: today.slice(0, 4) + "-01-01", to: today }),
    load: electricalSafetyReport,
  },
  {
    slug: "recalls", title: "Recalls",
    description: "Recalls open and issued in the period: devices affected, still to action and done, and the days each took to close.",
    filters: ["facility", "dateRange"], dateLabel: "Issued",
    defaults: (today) => ({ from: today.slice(0, 4) + "-01-01", to: today }),
    load: recallsReport,
  },
  {
    slug: "user-training", title: "User training",
    description: "For each device type in use: users with current training, refreshers due and departments without a trained user.",
    filters: ["facility"],
    load: userTrainingReport,
  },
  {
    slug: "gahar", title: "GAHAR evidence pack",
    description: "GAHAR 2025 standards for medical equipment (EFS.10–12, DAS.05, DAS.09): each evidence item with have, partly or missing, a count or percentage, and links to the records.",
    filters: ["facility", "dateRange"], dateLabel: "Period",
    defaults: (today) => ({ from: `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`, to: today }),
    load: gaharReport,
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
