import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Badge, Button, EmptyState, Field, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { DAY_NAMES, weekday } from "@/lib/assets/coverage";
import { holidaysBetween } from "@/lib/assets/coverage-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { addDaysISO, formatDate, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Public holidays" };

/**
 * A hospital's public holidays as contract covered hours see them (wave 38). Since wave 43 the list is kept under
 * Setup › Public holidays (`/admin/holidays`); this page only shows it.
 */
export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  const canEdit = can(me.role, "settings.manage");
  const header = <PageHeader title="Public holidays" back={{ href: "/assets/contracts", label: "Service contracts" }}
    description="Days a service contract's covered hours leave out, when the contract says so. The same list counts for every working-day count in the app." />;
  if (!facilityId) return <>{header}<EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const today = todayISO();
  const rows = await holidaysBetween(facilityId, addDaysISO(today, -365), addDaysISO(today, 730));

  return (
    <>
      {header}
      <p className="mb-4 text-sm">{canEdit
        ? <Link href="/admin/holidays" className="font-semibold text-primary hover:underline">Change the list under Setup › Public holidays</Link>
        : "An administrator keeps the list under Setup › Public holidays."}</p>
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      <Panel title={`Holidays (${rows.length})`} padded={false}>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No public holidays yet">An administrator adds them under Setup › Public holidays.</EmptyState></div> : (
          <Table>
            <THead><tr><Th>Date</Th><Th>Day</Th><Th>Holiday</Th></tr></THead>
            <tbody>{rows.map((h, i) => (
              <tr key={`${h.day}-${i}`} className={`border-t border-line ${h.day < today ? "text-muted" : ""}`}>
                <Td>{formatDate(h.day)}</Td><Td>{DAY_NAMES[weekday(h.day)]}</Td>
                <Td>{h.name} {h.approximate && <Badge tone="info">Moves each year</Badge>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
