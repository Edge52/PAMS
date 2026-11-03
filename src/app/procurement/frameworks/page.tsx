import Link from "next/link";
import { asc, desc, eq, or, isNull, inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities, frameworks, suppliers } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { addMonthsISO, CURRENCIES, formatDate, formatMoney, todayISO } from "@/lib/format";
import { calledOff } from "@/lib/procurement/money-server";
import { createFrameworkAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Framework agreements" };

export default async function FrameworksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("procurement.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const rows = await db.select({ f: frameworks, supplier: suppliers.name, facility: facilities.name }).from(frameworks).innerJoin(suppliers, eq(suppliers.id, frameworks.supplierId))
    .leftJoin(facilities, eq(facilities.id, frameworks.facilityId))
    .where(scope === null ? undefined : or(isNull(frameworks.facilityId), scope.length ? inArray(frameworks.facilityId, scope) : undefined)).orderBy(desc(frameworks.endDate));
  const used = new Map(await Promise.all(rows.map(async (r) => [r.f.id, (await calledOff(r.f.id)).value] as const)));
  const canEdit = can(me.role, "procurement.edit");
  const [sups, facs] = canEdit ? await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)),
  ]) : [[], []];
  const today = todayISO();
  return (
    <>
      <PageHeader title="Framework agreements" description="Agreed prices with a supplier up to a ceiling. Call off what you need as a purchase order without a new tender." />
      <Notice sp={sp} />
      {rows.length === 0 ? <EmptyState title="No framework agreements yet">{canEdit ? "Record one below once the agreement is signed." : "Procurement records them once signed."}</EmptyState> : (
        <Panel padded={false}>
          <ul className="divide-y divide-line">{rows.map((r) => {
            const u = used.get(r.f.id) ?? 0, c = Number(r.f.ceiling), live = today >= r.f.startDate && today <= r.f.endDate;
            return (
              <li key={r.f.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><Link href={`/procurement/frameworks/${r.f.id}`} className="font-semibold text-primary hover:underline">{r.f.number}</Link> {r.f.title} <span className="text-muted">· {r.supplier} · {r.facility ?? "all hospitals"}</span></span>
                  <Badge tone={live ? "ok" : today < r.f.startDate ? "info" : "neutral"}>{live ? `until ${formatDate(r.f.endDate)}` : today < r.f.startDate ? `from ${formatDate(r.f.startDate)}` : "ended"}</Badge>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true"><div className={u / c > 0.9 ? "h-full bg-warn" : "h-full bg-primary"} style={{ width: `${Math.min(100, (u / c) * 100)}%` }} /></div>
                <p className="mt-1 text-xs text-muted">{formatMoney(u, r.f.currency)} called off of {formatMoney(c, r.f.currency)} ({Math.round((u / c) * 100)} %)</p>
              </li>
            );
          })}</ul>
        </Panel>
      )}
      {canEdit && (
        <Panel title="Record a framework agreement" className="mt-6">
          <ActionForm action={createFrameworkAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Title" className="sm:col-span-2"><Input name="title" required maxLength={200} placeholder="e.g. Infusion pumps 2026–2027" /></Field>
            <Field label="Supplier"><NativeSelect name="supplierId" required placeholder="Choose…" options={sups.map((s) => ({ value: s.id, label: s.name }))} /></Field>
            <Field label="Hospital"><NativeSelect name="facilityId" placeholder="All hospitals" options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
            <Field label="Starts"><Input type="date" name="startDate" required defaultValue={today} /></Field>
            <Field label="Ends"><Input type="date" name="endDate" required defaultValue={addMonthsISO(today, 24)} /></Field>
            <Field label="Ceiling"><Input name="ceiling" required inputMode="decimal" /></Field>
            <Field label="Currency"><NativeSelect name="currency" value="EGP" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
            <Field label="Contract reference"><Input name="reference" maxLength={200} /></Field>
            <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" rows={2} /></Field>
            <div><Button>Create agreement</Button></div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
