import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, equipmentLoans, facilities, maintenanceEvents, safetyTests } from "@/db/schema";
import { Badge, Details, Field, FormGrid, Input, PageHeader, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/assets/bits";
import { CHECK_LABELS, checkState, DIRECTION_LABELS, LOAN_STATE_LABELS, LOAN_STATE_TONE, loanState, registerSuggestion } from "@/lib/assets/loans";
import { nextPpmDue } from "@/lib/assets/maintenance";
import { usageDueMap } from "@/lib/assets/meters-server";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { recordLoanCheckAction, returnLoanAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loan" };

export default async function LoanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const sp = await searchParams;
  const [r] = await db.select({
    l: equipmentLoans, facility: facilities.name, department: departments.name, tag: assets.assetTag, typeName: deviceTypes.name,
    manufacturer: assets.manufacturer, model: assets.model, status: assets.status, installDate: assets.installDate, purchaseDate: assets.purchaseDate, ppmIntervalMonths: deviceTypes.ppmIntervalMonths, maintenanceStrategy: deviceTypes.maintenanceStrategy,
  }).from(equipmentLoans).innerJoin(facilities, eq(facilities.id, equipmentLoans.facilityId)).leftJoin(departments, eq(departments.id, equipmentLoans.departmentId))
    .leftJoin(assets, eq(assets.id, equipmentLoans.assetId)).leftJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(eq(equipmentLoans.id, Number(id)));
  if (!r) notFound();
  await requireFacilityAccess(r.l.facilityId, me);
  const l = r.l, today = todayISO();
  const state = loanState(l, today), check = checkState(l);
  const canEdit = can(me.role, "assets.edit"), canCheck = can(me.role, "maintenance.edit");
  const activity = await getActivity("loan", l.id, 30);

  // What the register says about a borrowed device that is in it (a suggestion for the person checking).
  let hint: { ppmDue: string | null; safetyNextDue: string | null; safetyFailed: boolean } | null = null;
  if (l.assetId && l.direction === "BORROWED" && !l.returnedOn) {
    const [lastPpm] = await db.select({ d: sql<string | null>`max(${maintenanceEvents.completedDate})` }).from(maintenanceEvents)
      .where(and(eq(maintenanceEvents.assetId, l.assetId), eq(maintenanceEvents.type, "PPM"), eq(maintenanceEvents.status, "COMPLETED")));
    const usage = (await usageDueMap(today, { ids: [l.assetId] })).get(l.assetId);
    const ppm = nextPpmDue({ id: l.assetId, status: r.status, installDate: r.installDate, purchaseDate: r.purchaseDate, ppmIntervalMonths: r.ppmIntervalMonths, maintenanceStrategy: r.maintenanceStrategy, lastPpmDate: lastPpm?.d ?? null, usageDue: usage?.due });
    const [test] = await db.select({ result: safetyTests.result, nextDue: safetyTests.nextDue }).from(safetyTests).where(eq(safetyTests.assetId, l.assetId)).orderBy(desc(safetyTests.testedOn), desc(safetyTests.id)).limit(1);
    hint = { ppmDue: ppm.due, safetyNextDue: test?.nextDue ?? null, safetyFailed: test?.result === "FAIL" };
  }
  const suggest = hint ? registerSuggestion(hint, today) : null;
  const device = l.assetId ? `${r.typeName} ${r.tag}` : l.deviceDescription ?? "Device";

  return (
    <>
      <PageHeader back={{ href: "/assets/loans", label: "Loans and rentals" }}
        title={<span className="flex flex-wrap items-center gap-2">{l.number} <Badge tone={LOAN_STATE_TONE[state]}>{LOAN_STATE_LABELS[state]}</Badge>{check !== "NOT_NEEDED" && <Badge tone={check === "FIT" ? "ok" : check === "NOT_FIT" ? "danger" : "warn"}>{CHECK_LABELS[check]}</Badge>}</span>}
        description={`${DIRECTION_LABELS[l.direction]} ${l.otherParty}${l.isRental ? " (rental)" : ""}`} />
      <Notice sp={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Loan">
            <Details items={[
              { label: "Device", value: l.assetId ? <Link href={`/assets/${l.assetId}`} className="text-primary hover:underline">{device}</Link> : device },
              { label: "Make and model", value: [r.manufacturer, r.model].filter(Boolean).join(" ") || null },
              { label: "Serial number", value: l.serialNumber },
              { label: "Hospital", value: r.facility },
              { label: "For department", value: r.department },
              { label: "Why", value: l.purpose },
              { label: "Out on", value: formatDate(l.outOn) },
              { label: "Due back", value: l.dueBackOn ? <>{formatDate(l.dueBackOn)}{state === "OVERDUE" && <> <Badge tone="danger">Overdue</Badge></>}</> : "Not set" },
              { label: "Returned on", value: l.returnedOn ? formatDate(l.returnedOn) : null },
              { label: "Condition out", value: l.conditionOut },
              { label: "Condition back", value: l.conditionIn },
              { label: "Rental cost", value: l.cost ? formatMoney(l.cost, l.currency ?? "EGP") : null },
              { label: "Notes", value: l.notes },
              { label: "Recorded by", value: l.createdByName },
            ]} />
          </Panel>
          {l.direction === "BORROWED" && (
            <Panel title="Check before use">
              {l.checkedOn ? (
                <Details items={[
                  { label: "Planned maintenance in date", value: l.checkPpmOk ? "Yes" : <b className="text-danger">No</b> },
                  { label: "Electrical safety test in date", value: l.checkSafetyOk ? "Yes" : <b className="text-danger">No</b> },
                  { label: "Checked by, on", value: `${l.checkedByName ?? "—"}, ${formatDate(l.checkedOn)}` },
                  { label: "Note", value: l.checkNote },
                ]} />
              ) : <p className="text-sm text-muted">Not checked yet. Look at the device&apos;s maintenance and safety test labels and the lender&apos;s papers before it is used on a patient.</p>}
              {canCheck && !l.returnedOn && (
                <ActionForm action={recordLoanCheckAction} className="mt-4 space-y-3 border-t border-line pt-3">
                  <input type="hidden" name="loanId" value={l.id} />
                  {suggest && <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-sm">From the register: planned maintenance {hint?.ppmDue ? `due ${formatDate(hint.ppmDue)}` : "not recorded"}{suggest.ppmOk === false ? " (out of date)" : ""}; safety test {hint?.safetyFailed ? "last one failed" : hint?.safetyNextDue ? `due ${formatDate(hint.safetyNextDue)}` : "not recorded"}{suggest.safetyOk === false && !hint?.safetyFailed ? " (out of date)" : ""}.</p>}
                  <label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="checkPpmOk" className="size-5" defaultChecked={l.checkedOn ? !!l.checkPpmOk : suggest?.ppmOk === true} /> Planned maintenance is in date</label>
                  <label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="checkSafetyOk" className="size-5" defaultChecked={l.checkedOn ? !!l.checkSafetyOk : suggest?.safetyOk === true} /> Electrical safety test is in date</label>
                  <FormGrid cols={2}>
                    <Field label="Checked on"><Input type="date" name="checkedOn" defaultValue={today} max={today} /></Field>
                    <Field label="Note" hint="Needed when something is out of date."><Input name="checkNote" maxLength={1000} defaultValue={l.checkNote ?? ""} /></Field>
                  </FormGrid>
                  <SubmitButton variant="secondary">Record the check</SubmitButton>
                </ActionForm>
              )}
            </Panel>
          )}
        </div>
        <aside className="space-y-6">
          {canEdit && !l.returnedOn && (
            <Panel title="Record the return">
              <ActionForm action={returnLoanAction} className="space-y-3">
                <input type="hidden" name="loanId" value={l.id} />
                <Field label="Returned on"><Input type="date" name="returnedOn" defaultValue={today} max={today} /></Field>
                <Field label="Condition when it came back"><Input name="conditionIn" maxLength={500} /></Field>
                <SubmitButton>Record the return</SubmitButton>
              </ActionForm>
            </Panel>
          )}
          <Panel title="Activity">
            {activity.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
              <ol className="space-y-2.5 text-sm">
                {activity.map((ev) => <li key={ev.id}><span className="text-xs text-muted">{formatDate(ev.at)}{ev.actor ? ` · ${ev.actor}` : ""}</span><br />{ev.summary}</li>)}
              </ol>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
