import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, publicHolidays } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/confirm";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { DAY_NAMES, weekday } from "@/lib/assets/coverage";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { addEgyptHolidaysAction, removeHolidayAction, saveHolidayAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Public holidays" };

/** A hospital's public holidays (wave 38): days a contract's covered hours leave out. */
export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  const header = <PageHeader title="Public holidays" back={{ href: "/assets/contracts", label: "Service contracts" }}
    description="Days a service contract's covered hours leave out, when the contract says so. Religious holidays follow the moon: check their dates when they are announced." />;
  if (!facilityId) return <>{header}<EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const rows = await db.select().from(publicHolidays).where(eq(publicHolidays.facilityId, facilityId)).orderBy(asc(publicHolidays.day));
  const canEdit = can(me.role, "contracts.edit");
  const today = todayISO();

  return (
    <>
      {header}
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] [&>*]:min-w-0">
        <Panel title={`Holidays (${rows.length})`} padded={false}>
          {rows.length === 0 ? <div className="p-4"><EmptyState title="No public holidays yet">{canEdit ? "Add the usual Egyptian holidays for 2026–2027 with the button on this page, then correct any dates." : "A contract manager adds them."}</EmptyState></div> : (
            <Table>
              <THead><tr><Th>Date</Th><Th>Day</Th><Th>Holiday</Th>{canEdit && <Th />}</tr></THead>
              <tbody>{rows.map((h) => (
                <tr key={h.id} className={`border-t border-line ${h.day < today ? "text-muted" : ""}`}>
                  <Td>{formatDate(h.day)}</Td><Td>{DAY_NAMES[weekday(h.day)]}</Td>
                  <Td>{h.name} {h.approximate && <Badge tone="warn">Date approximate</Badge>}</Td>
                  {canEdit && <Td align="right"><form action={removeHolidayAction}><input type="hidden" name="id" value={h.id} />
                    <ConfirmButton confirm={`Remove ${h.name} on ${formatDate(h.day)}?`} className="text-sm text-danger hover:underline" aria-label={`Remove ${h.name} on ${formatDate(h.day)}`}>Remove</ConfirmButton></form></Td>}
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Panel>
        {canEdit && (
          <aside className="space-y-6">
            <Panel title="Add or correct a holiday">
              <ActionForm action={saveHolidayAction} className="space-y-3">
                <input type="hidden" name="facilityId" value={facilityId} />
                <Field label="Date" hint="A date already on the list is renamed."><Input type="date" name="day" required /></Field>
                <Field label="Name"><Input name="name" required maxLength={120} placeholder="e.g. Eid al-Fitr" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="approximate" /> Date approximate (not yet announced)</label>
                <SubmitButton>Save holiday</SubmitButton>
              </ActionForm>
            </Panel>
            <Panel title="Egyptian holidays 2026–2027">
              <p className="mb-3 text-sm text-muted">Adds the official holidays, with the dates the government moved to a Thursday where announced. Eid and other Islamic holidays are marked approximate. Dates already on the list stay as they are.</p>
              <ActionForm action={addEgyptHolidaysAction}>
                <input type="hidden" name="facilityId" value={facilityId} />
                <SubmitButton variant="secondary">Add the Egyptian holidays</SubmitButton>
              </ActionForm>
            </Panel>
          </aside>
        )}
      </div>
    </>
  );
}
