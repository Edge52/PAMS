import "server-only";
import { facilityScope, type CurrentUser } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { facilityFilter } from "./calc";
import { describeFilters, reportFilters, type ReportDef } from "./registry";
import { facilityName, facilityOptions } from "./shared";
import type { ReportFilters, ReportResult } from "./types";

export type ReportRun =
  | { forbidden: true }
  | { forbidden: false; filters: ReportFilters; result: ReportResult; facility: string | null; lines: string[];
      facilities: { id: number; code: string; name: string }[]; today: string };

/** Parse filters, enforce facility access, and load the report for this user. Shared by the page and the export. */
export async function runReport(def: ReportDef, params: URLSearchParams | Record<string, string | string[] | undefined>, me: CurrentUser): Promise<ReportRun> {
  const today = todayISO();
  const filters = reportFilters(def, params, today);
  const scope = await facilityScope(me);
  if (facilityFilter(filters.facilityId, scope) === "forbidden") return { forbidden: true };
  const [result, facility, facilities] = await Promise.all([
    def.load({ filters, scope, today }),
    facilityName(filters.facilityId),
    facilityOptions(scope),
  ]);
  return { forbidden: false, filters, result, facility, facilities, today, lines: describeFilters(def, filters, facility) };
}
