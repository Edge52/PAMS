import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { Button, Field, Input, Select } from "@/components/ui";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import type { Filters } from "@/lib/analytics/core";
import { analyticsScope, inScope } from "@/lib/analytics/scope-server";

/**
 * The filter bar every Analytics tab shows (wave 40): hospital, department, device type and the period. A plain GET
 * form with no action, so it submits to the tab it is on and the filters stay in the URL (bookmark, share, export).
 * Loads its own choices, limited to the hospitals the user may see.
 */
export async function AnalyticsFilters({ filters }: { filters: Filters }) {
  const me = await requireUser();
  const all = await analyticsScope(me, { facilityId: null });
  const ids = filters.facilityId && all.includes(filters.facilityId) ? [filters.facilityId] : all;
  const [hospitals, depts, types] = await Promise.all([
    db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities).where(inScope(facilities.id, all)).orderBy(asc(facilities.code)),
    db.select({ id: departments.id, name: departments.name, facility: facilities.code }).from(departments)
      .innerJoin(facilities, eq(facilities.id, departments.facilityId)).where(inScope(departments.facilityId, ids))
      .orderBy(asc(facilities.code), asc(departments.name)).limit(500),
    // Only device types the hospitals actually have.
    ids.length ? db.selectDistinct({ id: deviceTypes.id, name: deviceTypes.name }).from(deviceTypes)
      .innerJoin(assets, eq(assets.deviceTypeId, deviceTypes.id))
      .where(and(inArray(assets.facilityId, ids), ne(assets.status, "DISPOSED"))).orderBy(asc(deviceTypes.name)).limit(500) : Promise.resolve([]),
  ]);
  const many = hospitals.length > 1;
  return (
    <form className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3" aria-label="Filters">
      <Field label="Hospital" className="min-w-[12rem]">
        <Select name="facilityId" defaultValue={filters.facilityId ?? ""} placeholder={many ? "All hospitals" : undefined}
          options={hospitals.map((h) => ({ value: h.id, label: h.name }))} />
      </Field>
      <Field label="Department" className="min-w-[12rem]">
        <Select name="departmentId" defaultValue={filters.departmentId ?? ""} placeholder="All departments"
          options={depts.map((d) => ({ value: d.id, label: ids.length > 1 ? `${d.name} (${d.facility})` : d.name }))} />
      </Field>
      <Field label="Device type" className="min-w-[12rem]">
        <Select name="deviceTypeId" defaultValue={filters.deviceTypeId ?? ""} placeholder="All device types"
          options={types.map((t) => ({ value: t.id, label: t.name }))} />
      </Field>
      <Field label="From"><Input type="date" name="from" defaultValue={filters.from} /></Field>
      <Field label="To"><Input type="date" name="to" defaultValue={filters.to} /></Field>
      <Button variant="secondary">Apply filters</Button>
      <a href="?" className="px-1 py-1.5 text-sm text-primary hover:underline">Reset</a>
    </form>
  );
}
