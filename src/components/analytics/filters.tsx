/** Stand-in (wave 40, agent F) for agent E's Analytics filter bar: the lead keeps E's version at merge. */
import { Button, Field, Input } from "@/components/ui";
import type { Filters } from "@/lib/analytics/core";

export async function AnalyticsFilters({ filters }: { filters: Filters }) {
  return (
    <form className="mb-5 flex flex-wrap items-end gap-3" aria-label="Filters">
      {filters.facilityId && <input type="hidden" name="facilityId" value={filters.facilityId} />}
      <Field label="From"><Input type="date" name="from" defaultValue={filters.from} /></Field>
      <Field label="To"><Input type="date" name="to" defaultValue={filters.to} /></Field>
      <Button variant="secondary">Apply filters</Button>
    </form>
  );
}
