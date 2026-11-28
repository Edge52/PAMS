import Link from "next/link";
import { and, asc, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { facilities, holidays, publicHolidays } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/confirm";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { DAY_NAMES, weekday } from "@/lib/assets/coverage";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { isWeekend } from "@/lib/working-days";
import { copyLastYearAction, importHolidaysAction, moveOldHolidaysAction, removeHolidayAction, saveHolidayAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Public holidays" };

/**
 * Public holidays (wave 43, Setup): one list for every working-day count — approval reminders, fault report targets,
 * contract covered hours and daily imaging QC. No built-in dates: the hospital enters them.
 */
export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("settings.manage");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const today = todayISO();
  const thisYear = Number(today.slice(0, 4));
  const year = Number.isInteger(Number(sp.year)) && Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : thisYear;
  const facs = await db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const ids = facs.map((f) => f.id);
  let rows: (typeof holidays.$inferSelect)[] = [];
  let oldCount = 0;
  let missing = false;
  try {
    rows = await db.select().from(holidays).where(and(gte(holidays.day, `${year}-01-01`), lte(holidays.day, `${year}-12-31`),
      scope === null ? undefined : ids.length ? or(isNull(holidays.facilityId), inArray(holidays.facilityId, ids)) : isNull(holidays.facilityId)))
      .orderBy(asc(holidays.day)).limit(2000);
  } catch {
    missing = true; // the wave 43 migration has not run yet
  }
  try {
    oldCount = (await db.select({ id: publicHolidays.id }).from(publicHolidays).where(scope === null ? undefined : ids.length ? inArray(publicHolidays.facilityId, ids) : isNull(publicHolidays.id)).limit(5000)).length;
  } catch { oldCount = 0; }
  const name = new Map(facs.map((f) => [f.id, f.name]));
  const allowAll = scope === null;
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2].filter((y, i, a) => a.indexOf(y) === i);
  if (!years.includes(year)) years.push(year);

  return (
    <>
      <PageHeader title="Public holidays" back={{ href: "/modules/setup", label: "Setup" }}
        description="Days off besides Friday and Saturday. Every working-day count uses them: approval reminders, fault report targets, contract covered hours and daily imaging QC." />
      <p className="mb-4 rounded-[var(--radius-panel)] border border-warn bg-warn-soft p-3 text-sm">
        There is no built-in list: enter your hospital&apos;s dates. Islamic holidays (Eid al-Fitr, Eid al-Adha, Islamic New Year, the Prophet&apos;s Birthday) move about 11 days earlier each year with the moon, and the government often moves a fixed holiday to a Thursday or Sunday. Check the dates when they are announced.
      </p>
      {missing && <p role="alert" className="mb-4 text-sm font-semibold text-danger">The holidays table is not in the database yet. Restart the app so it updates the database.</p>}
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <AutoSubmit />
        <Field label="Year"><NativeSelect name="year" value={year} options={years.sort().map((y) => ({ value: y, label: String(y) }))} /></Field>
        <Button variant="secondary">Show</Button>
      </form>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] [&>*]:min-w-0">
        <Panel title={`Holidays in ${year} (${rows.length})`} padded={false}>
          {rows.length === 0 ? <div className="p-4"><EmptyState title={`No public holidays for ${year} yet`}>Add them one by one, import the Excel template, or copy last year&apos;s fixed-date holidays.</EmptyState></div> : (
            <Table>
              <THead><tr><Th>Date</Th><Th>Day</Th><Th>Holiday</Th><Th>Hospital</Th><Th /></tr></THead>
              <tbody>{rows.map((h) => (
                <tr key={h.id} className={`border-t border-line ${h.day < today ? "text-muted" : ""}`}>
                  <Td className="whitespace-nowrap">{formatDate(h.day)}</Td>
                  <Td>{DAY_NAMES[weekday(h.day)]}{isWeekend(h.day) && <span className="block text-xs text-muted">Weekend anyway</span>}</Td>
                  <Td>{h.name} {h.moves && <Badge tone="info">Moves each year</Badge>}</Td>
                  <Td>{h.facilityId == null ? "Every hospital" : name.get(h.facilityId) ?? `Hospital ${h.facilityId}`}</Td>
                  <Td align="right">{(h.facilityId != null || allowAll) && <form action={removeHolidayAction}><input type="hidden" name="id" value={h.id} />
                    <ConfirmButton confirm={`Remove ${h.name} on ${formatDate(h.day)}?`} className="text-sm text-danger hover:underline" aria-label={`Remove ${h.name} on ${formatDate(h.day)}`}>Remove</ConfirmButton></form>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Panel>
        <aside className="space-y-6">
          <Panel title="Add or correct a holiday">
            <ActionForm action={saveHolidayAction} className="space-y-3">
              <Field label="Date" hint="A date already on the list for the same hospital is renamed."><Input type="date" name="day" required /></Field>
              <Field label="Name"><Input name="name" required maxLength={120} placeholder="e.g. Eid al-Fitr" /></Field>
              <Field label="Hospital"><NativeSelect name="facilityId" value={allowAll ? "" : facs[0]?.id} placeholder={allowAll ? "Every hospital" : undefined}
                options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="moves" /> Date moves each year (Islamic holiday)</label>
              <SubmitButton>Save holiday</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Import from Excel or CSV">
            <p className="mb-3 text-sm text-muted">Columns: Date, Holiday, Hospital (code or name; blank for every hospital), Moves each year. <Link href="/admin/holidays/template" className="font-semibold text-primary hover:underline">Download the template</Link>.</p>
            <ActionForm action={importHolidaysAction} className="space-y-3">
              <Field label="File (.xlsx or .csv)"><input type="file" name="file" accept=".xlsx,.csv" required className="block w-full text-sm" /></Field>
              <SubmitButton variant="secondary">Import</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Copy last year">
            <p className="mb-3 text-sm text-muted">Copies {year - 1}&apos;s holidays that fall on the same date every year to {year}. Holidays marked as moving are left out: add those yourself.</p>
            <ActionForm action={copyLastYearAction}>
              <input type="hidden" name="year" value={year - 1} />
              <SubmitButton variant="secondary">Copy {year - 1}&apos;s fixed-date holidays to {year}</SubmitButton>
            </ActionForm>
          </Panel>
          {oldCount > 0 && (
            <Panel title="Older contract holidays">
              <p className="mb-3 text-sm text-muted">{oldCount} holiday{oldCount === 1 ? "" : "s"} from the older service contract list. They still count; move them here to keep one list.</p>
              <ActionForm action={moveOldHolidaysAction}>
                <SubmitButton variant="secondary">Move them here</SubmitButton>
              </ActionForm>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
