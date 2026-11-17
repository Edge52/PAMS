import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, suppliers } from "@/db/schema";
import { Field, FormGrid, Input, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { inScope, scopeWhere } from "@/lib/assets/access";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { CURRENCIES, todayISO } from "@/lib/format";
import { createLoanAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record a loan" };

export default async function NewLoanPage({ searchParams }: { searchParams: Promise<{ assetId?: string; direction?: string }> }) {
  const me = await requirePermission("assets.edit");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const assetId = Number(sp.assetId);
  const [a] = Number.isInteger(assetId) && assetId > 0
    ? await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, typeName: deviceTypes.name, departmentId: assets.departmentId }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId))
    : [];
  const device = a && inScope(scope, a.facilityId) ? a : null;
  const [facs, depts, sups] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)),
    db.select({ id: departments.id, name: departments.name, facility: facilities.code }).from(departments).innerJoin(facilities, eq(facilities.id, departments.facilityId))
      .where(scopeWhere(departments.facilityId, scope)).orderBy(asc(facilities.code), asc(departments.name)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
  ]);
  const today = todayISO();
  const direction = sp.direction === "LENT" ? "LENT" : "BORROWED";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Record a loan" back={{ href: "/assets/loans", label: "Loans and rentals" }}
        description="A device borrowed from a supplier or another hospital (or rented), or one of ours lent out." />
      <Panel>
        <ActionForm action={createLoanAction} className="space-y-5">
          <FormGrid cols={2}>
            <Field label="This device is"><Select name="direction" defaultValue={direction} options={[{ value: "BORROWED", label: "Borrowed by us (or rented)" }, { value: "LENT", label: "Lent by us" }]} /></Field>
            <div className="flex items-end pb-2"><label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="isRental" className="size-5" /> It is a paid rental</label></div>
          </FormGrid>
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-bold">The other party</legend>
            <FormGrid cols={2}>
              <Field label="Supplier" hint="If it is a supplier in the list."><Select name="supplierId" placeholder="Not a listed supplier" options={sups.map((s) => ({ value: String(s.id), label: s.name }))} /></Field>
              <Field label="Or name" hint="Another hospital, or a supplier not in the list."><Input name="otherParty" maxLength={200} placeholder="e.g. Nasser Institute Hospital" /></Field>
            </FormGrid>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-bold">The device</legend>
            {device ? (
              <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-sm"><input type="hidden" name="assetTag" value={device.tag} />Device: <b className="font-mono">{device.tag}</b> · {device.typeName}</p>
            ) : (
              <FormGrid cols={2}>
                <Field label="Asset tag" hint="If it is in the register (always, for a device we lend)."><Input name="assetTag" maxLength={48} className="uppercase" placeholder="DGH-INF-000012" /></Field>
                <Field label="Or describe it" hint="A borrowed device that is not in the register."><Input name="deviceDescription" maxLength={300} placeholder="e.g. Syringe pump, B. Braun Perfusor Space" /></Field>
                <Field label="Serial number"><Input name="serialNumber" maxLength={128} /></Field>
                <Field label="Hospital" hint="Taken from the device when it has a tag."><Select name="facilityId" defaultValue={facs.length === 1 ? String(facs[0].id) : ""} placeholder="Choose…" options={facs.map((f) => ({ value: String(f.id), label: f.name }))} /></Field>
              </FormGrid>
            )}
            <FormGrid cols={2}>
              <Field label="For department"><Select name="departmentId" defaultValue={device?.departmentId ? String(device.departmentId) : ""} placeholder="—" options={depts.map((d) => ({ value: String(d.id), label: `${d.name} (${d.facility})` }))} /></Field>
              <Field label="Why"><Input name="purpose" maxLength={500} placeholder="e.g. Cover while ours is repaired under WO-2026-0042" /></Field>
            </FormGrid>
          </fieldset>
          <FormGrid cols={3}>
            <Field label="Out on"><Input type="date" name="outOn" required defaultValue={today} max={today} /></Field>
            <Field label="Due back"><Input type="date" name="dueBackOn" /></Field>
            <Field label="Condition when it went out"><Input name="conditionOut" maxLength={500} placeholder="e.g. Good, with power lead and 2 lines" /></Field>
            <Field label="Rental cost"><Input type="number" name="cost" min={0} step="0.01" /></Field>
            <Field label="Currency"><Select name="currency" defaultValue="EGP" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
          </FormGrid>
          <Field label="Notes"><Textarea name="notes" rows={2} maxLength={2000} /></Field>
          <SubmitButton pendingLabel="Saving…">Record the loan</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
