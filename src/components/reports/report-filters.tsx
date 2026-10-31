import Link from "next/link";
import { Button, Field, Input, Select } from "@/components/ui";
import { DAY_WINDOWS, GRACE_OPTIONS } from "@/lib/reports/calc";
import type { FilterKind, ReportFilters } from "@/lib/reports/types";

/** Plain GET form: filters live in the URL, so a filtered report can be bookmarked, shared and exported. */
export function ReportFiltersForm({ action, kinds, filters, facilities, dateLabel }: {
  action: string; kinds: FilterKind[]; filters: ReportFilters;
  facilities: { id: number; code: string; name: string }[]; dateLabel?: string;
}) {
  return (
    <form action={action} className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3">
      {kinds.includes("facility") && (
        <Field label="Facility" className="min-w-[14rem]">
          <Select name="facilityId" defaultValue={filters.facilityId ?? ""} placeholder={facilities.length > 1 ? "All facilities" : undefined}
            options={facilities.map((f) => ({ value: f.id, label: `${f.name} (${f.code})` }))} />
        </Field>
      )}
      {kinds.includes("projectStatus") && (
        <Field label="Projects">
          <Select name="status" defaultValue={filters.projectStatus}
            options={[{ value: "open", label: "Open projects" }, { value: "all", label: "All, including closed" }]} />
        </Field>
      )}
      {kinds.includes("dateRange") && (
        <>
          <Field label={`${dateLabel ?? "Date"} from`}><Input type="date" name="from" defaultValue={filters.from ?? ""} /></Field>
          <Field label="to"><Input type="date" name="to" defaultValue={filters.to ?? ""} /></Field>
        </>
      )}
      {kinds.includes("days") && (
        <Field label="Ending within">
          <Select name="days" defaultValue={filters.days}
            options={[...new Set([...DAY_WINDOWS, filters.days])].sort((a, b) => a - b).map((d) => ({ value: d, label: `${d} days` }))} />
        </Field>
      )}
      {kinds.includes("grace") && (
        <Field label="On time if done within">
          <Select name="grace" defaultValue={filters.grace}
            options={[...new Set([...GRACE_OPTIONS, filters.grace])].sort((a, b) => a - b).map((d) => ({ value: d, label: d === 0 ? "the scheduled day" : `${d} days of the date` }))} />
        </Field>
      )}
      <Button variant="secondary">Apply filters</Button>
      <Link href={action} className="px-1 py-1.5 text-sm text-primary hover:underline">Reset</Link>
    </form>
  );
}
