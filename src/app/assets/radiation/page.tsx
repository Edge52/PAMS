import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Badge, Button, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Select, Stat, TabLinks, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect, Notice, RoomSelect } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { locationTree } from "@/lib/assets/queries";
import {
  ANNUAL_LIMIT_MSV, CHECK_STATE_LABELS, DOSE_FLAG_LABELS, DOSE_FLAG_TONE, INVESTIGATION_SHARE, LICENCE_STATE_LABELS, PROTECTIVE_KIND_LABELS, PROTECTIVE_KINDS,
  QC_TESTS, TONE, type DoseFlag, type ProtectiveKind,
} from "@/lib/assets/radiation";
import { radiationOverview } from "@/lib/assets/radiation-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { capRows } from "@/lib/list";
import { addLicenceAction, addProtectiveItemAction, recordDoseAction, recordProtectiveCheckAction, recordQcAction, retireProtectiveItemAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Radiation safety" };

const TABS = ["rooms", "licences", "qc", "dosimetry", "protective"] as const;
const ROOM_TONE = { problem: "danger", attention: "warn", ok: "ok" } as const;
const ROOM_LABEL = { problem: "Action needed", attention: "Due soon", ok: "In order" } as const;

/**
 * Radiation safety for one hospital (wave 37): ENRRA licences per room or device, physicist QC tests, staff
 * dosimetry and protective equipment checks, with the status of each imaging room.
 */
export default async function RadiationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.id));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || null) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Radiation safety" /><EmptyState title="No hospital to show">You don&apos;t have access to any hospital yet.</EmptyState></>;
  await requireFacilityAccess(facilityId, me);
  const tab = TABS.find((t) => t === sp.tab) ?? "rooms";
  const today = todayISO();
  const canEdit = can(me.role, "maintenance.edit");
  const [o, tree] = await Promise.all([radiationOverview(facilityId, today), canEdit ? locationTree(facilityId, null) : Promise.resolve(null)]);
  const facilityName = facs.find((f) => f.id === facilityId)?.name ?? "";

  const licBad = o.licences.filter((l) => l.state !== "ok").length;
  const qcBad = o.qc.filter((q) => q.state !== "ok").length;
  const protBad = o.protective.filter((p) => p.state !== "ok").length;
  const doseFlags = o.doses.filter((d) => d.d.flag !== "OK").length;
  const roomsBad = o.rooms.filter((r) => r.status.state === "problem").length;
  const href = (t: string) => `/assets/radiation?facilityId=${facilityId}&tab=${t}`;
  const deviceOptions = o.devices.map((d) => ({ value: d.id, label: `${d.tag} — ${d.typeName}${d.roomId ? "" : " (no room)"}` }));

  return (
    <>
      <PageHeader title="Radiation safety" description={`${facilityName}: ENRRA licences, physicist QC tests, staff dosimetry and protective equipment for the X-ray, CT, C-arm and other radiation rooms.`} />
      <Notice sp={sp} />
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <input type="hidden" name="tab" value={tab} />
          <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Rooms needing action" value={formatNumber(roomsBad)} hint={`${o.rooms.length} rooms, ${o.devices.length} devices`} href={href("rooms")} />
        <Stat label="Licences expiring or expired" value={formatNumber(licBad)} hint={`${o.licences.length} licences`} href={href("licences")} />
        <Stat label="QC tests due or failed" value={formatNumber(qcBad)} href={href("qc")} />
        <Stat label="Protective items due or failed" value={formatNumber(protBad)} hint={`${o.protective.length} items`} href={href("protective")} />
        <Stat label="Dose readings flagged" value={formatNumber(doseFlags)} hint="Last 12 months" href={href("dosimetry")} />
      </div>
      <TabLinks active={tab} tabs={[
        { key: "rooms", label: "Rooms", href: href("rooms") }, { key: "licences", label: `ENRRA licences (${o.licences.length})`, href: href("licences") },
        { key: "qc", label: "Physicist QC", href: href("qc") }, { key: "dosimetry", label: "Dosimetry", href: href("dosimetry") },
        { key: "protective", label: "Protective equipment", href: href("protective") },
      ]} />

      {tab === "rooms" && (o.rooms.length === 0 && o.unplaced.length === 0 ? (
        <EmptyState title="No radiation rooms or devices here">Rooms appear here when an X-ray, CT, C-arm, mammography, angiography, nuclear medicine or dental X-ray device is placed in them, or when a licence or protective item is recorded for them.</EmptyState>
      ) : (
        <>
          <Table>
            <THead><tr><Th>Room</Th><Th>Devices</Th><Th>Status</Th><Th>What needs doing</Th></tr></THead>
            <tbody>{o.rooms.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/assets/map?roomId=${r.id}`} className="font-semibold text-primary hover:underline">{r.name}</Link><span className="block font-mono text-xs text-muted">{r.code} · {r.floorName}{r.departmentName ? ` · ${r.departmentName}` : ""}</span></Td>
                <Td>{r.devices.length === 0 ? <span className="text-muted">—</span> : r.devices.map((d) => <Link key={d.id} href={`/assets/${d.id}#radiation`} className="block font-mono text-sm text-primary hover:underline">{d.tag}<span className="ml-1 font-sans text-xs text-muted">{d.typeName}</span></Link>)}</Td>
                <Td><Badge tone={ROOM_TONE[r.status.state]}>{ROOM_LABEL[r.status.state]}</Badge></Td>
                <Td className="text-sm">{r.status.reasons.join(" · ") || <span className="text-muted">Nothing</span>}</Td>
              </tr>
            ))}</tbody>
          </Table>
          {o.unplaced.length > 0 && <p className="mt-3 text-sm text-warn">Not in a room: {o.unplaced.map((d, i) => <span key={d.id}>{i ? ", " : ""}<Link href={`/assets/${d.id}`} className="font-mono text-primary hover:underline">{d.tag}</Link></span>)}. Place them in their room so the room&apos;s licence and checks apply.</p>}
        </>
      ))}

      {tab === "licences" && (
        <div className="space-y-5">
          {o.licences.length === 0 ? <EmptyState title="No ENRRA licences on record">Each X-ray, CT or C-arm room (or mobile unit) needs a valid licence from the Egyptian Nuclear and Radiological Regulatory Authority. Record it below and attach the scan.</EmptyState> : (
            <Table>
              <THead><tr><Th>Licence</Th><Th>Covers</Th><Th>Scope</Th><Th>Expires</Th></tr></THead>
              <tbody>{o.licences.map(({ l, roomName, roomCode, tag, state }) => (
                <tr key={l.id}>
                  <Td><Link href={`/assets/radiation/licences/${l.id}`} className="font-semibold text-primary hover:underline">{l.licenceNumber}</Link>{l.issuedOn && <span className="block text-xs text-muted">Issued {formatDate(l.issuedOn)}</span>}</Td>
                  <Td>{roomName && <span className="block">{roomName} <span className="font-mono text-xs text-muted">{roomCode}</span></span>}{tag && <Link href={`/assets/${l.assetId}`} className="font-mono text-sm text-primary hover:underline">{tag}</Link>}</Td>
                  <Td className="max-w-xs text-sm">{l.scope ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{formatDate(l.expiresOn)} <Badge tone={TONE[state]}>{LICENCE_STATE_LABELS[state]}</Badge></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          {canEdit && tree && <Panel title="Record a licence">
            <ActionForm action={addLicenceAction} className="space-y-3">
              <input type="hidden" name="facilityId" value={facilityId} />
              <FormGrid cols={2}>
                <Field label="Licence number"><Input name="licenceNumber" required maxLength={80} /></Field>
                <Field label="Expires on"><Input type="date" name="expiresOn" required /></Field>
                <Field label="Room" hint="The room the licence is for."><RoomSelect tree={tree} placeholder="Choose a room…" /></Field>
                <Field label="Or a device" hint="For a mobile unit or C-arm licensed on its own."><NativeSelect name="assetId" options={deviceOptions} placeholder="No device" /></Field>
                <Field label="Issued on"><Input type="date" name="issuedOn" max={today} /></Field>
                <Field label="Scope" hint="What it allows, in the licence's words."><Input name="scope" maxLength={500} placeholder="e.g. Diagnostic radiology, one fixed X-ray unit" /></Field>
              </FormGrid>
              <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
              <SubmitButton variant="secondary">Save licence</SubmitButton>
            </ActionForm>
          </Panel>}
        </div>
      )}

      {tab === "qc" && (
        <div className="space-y-5">
          {o.qc.length === 0 ? <EmptyState title="No physicist QC tests on record">The medical physicist tests each X-ray, CT and fluoroscopy unit at least once a year (output, image quality, dose) and surveys the room&apos;s shielding. Record each test below.</EmptyState> : (
            <Table>
              <THead><tr><Th>Device or room</Th><Th>Test</Th><Th>Last test</Th><Th>Result</Th><Th>Next due</Th></tr></THead>
              <tbody>{o.qc.toSorted((a, b) => (a.nextDue ?? "").localeCompare(b.nextDue ?? "")).map((q) => (
                <tr key={q.id}>
                  <Td>{q.assetId ? <Link href={`/assets/${q.assetId}#radiation`} className="font-mono text-sm text-primary hover:underline">{q.tag}</Link> : q.roomName ?? "—"}</Td>
                  <Td>{q.testName}{q.notes && <span className="block max-w-xs text-xs text-muted">{q.notes}</span>}</Td>
                  <Td className="whitespace-nowrap">{formatDate(q.testedOn)}<span className="block text-xs text-muted">{q.physicist}</span></Td>
                  <Td><Badge tone={q.result === "PASS" ? "ok" : "danger"}>{q.result === "PASS" ? "Passed" : "Failed"}</Badge></Td>
                  <Td className="whitespace-nowrap">{q.nextDue ? formatDate(q.nextDue) : "Retest after repair"} {q.state !== "ok" && q.state !== "failed" && <Badge tone={TONE[q.state]}>{CHECK_STATE_LABELS[q.state]}</Badge>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          {canEdit && tree && <Panel title="Record a QC test">
            <ActionForm action={recordQcAction} className="space-y-3">
              <input type="hidden" name="facilityId" value={facilityId} />
              <datalist id="dl-qc-tests">{QC_TESTS.map((t) => <option key={t} value={t} />)}</datalist>
              <FormGrid cols={2}>
                <Field label="Device"><NativeSelect name="assetId" options={deviceOptions} placeholder="Choose a device…" /></Field>
                <Field label="Or a room" hint="For a shielding survey."><RoomSelect tree={tree} placeholder="No room" /></Field>
                <Field label="Test"><Input name="testName" required maxLength={160} list="dl-qc-tests" defaultValue={QC_TESTS[0]} /></Field>
                <Field label="Tested on"><Input type="date" name="testedOn" required max={today} defaultValue={today} /></Field>
                <Field label="Physicist"><Input name="physicist" required maxLength={160} /></Field>
                <Field label="Result"><Select name="result" required placeholder="Choose…" options={[{ value: "PASS", label: "Passed" }, { value: "FAIL", label: "Failed" }]} /></Field>
                <Field label="Next test in (months)"><Input type="number" name="intervalMonths" min={1} max={60} defaultValue={12} /></Field>
              </FormGrid>
              <Field label="Notes"><Textarea name="notes" rows={2} placeholder="Readings out of limits, actions asked for" /></Field>
              <SubmitButton variant="secondary">Save QC test</SubmitButton>
            </ActionForm>
          </Panel>}
        </div>
      )}

      {tab === "dosimetry" && <Dosimetry o={o} canEdit={canEdit} facilityId={facilityId} departments={tree?.departments ?? []} />}

      {tab === "protective" && (
        <div className="space-y-5">
          {o.protective.length === 0 ? <EmptyState title="No protective equipment listed">List each lead apron, thyroid collar and mobile shield with its number, then record its checks (usually a yearly visual and X-ray screening).</EmptyState> : (
            <Table>
              <THead><tr><Th>Item</Th><Th>Where</Th><Th>Last check</Th><Th>Next due</Th>{canEdit && <Th><span className="sr-only">Actions</span></Th>}</tr></THead>
              <tbody>{o.protective.toSorted((a, b) => (a.last?.nextDue ?? "").localeCompare(b.last?.nextDue ?? "")).map((p) => (
                <tr key={p.i.id}>
                  <Td><b>{p.i.label}</b><span className="block text-xs text-muted">{PROTECTIVE_KIND_LABELS[p.i.kind as ProtectiveKind] ?? p.i.kind} · every {p.i.intervalMonths} months</span></Td>
                  <Td>{[p.roomName, p.departmentName].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td className="whitespace-nowrap">{p.last ? <>{formatDate(p.last.checkedOn)} <Badge tone={p.last.result === "PASS" ? "ok" : "danger"}>{p.last.result === "PASS" ? "Passed" : "Failed"}</Badge><span className="block text-xs text-muted">{p.last.checkedBy}{p.last.method ? ` · ${p.last.method}` : ""}</span></> : <span className="text-muted">Never</span>}</Td>
                  <Td className="whitespace-nowrap">{p.last?.nextDue ? formatDate(p.last.nextDue) : ""} <Badge tone={TONE[p.state]}>{CHECK_STATE_LABELS[p.state]}</Badge></Td>
                  {canEdit && <Td><ActionForm action={retireProtectiveItemAction} confirm={`Take ${p.i.label} off the list? Do this when it is thrown away.`} confirmLabel="Take off the list">
                    <input type="hidden" name="itemId" value={p.i.id} /><button className="text-xs text-danger hover:underline">Take off the list</button></ActionForm></Td>}
                </tr>
              ))}</tbody>
            </Table>
          )}
          {canEdit && tree && o.protective.length > 0 && <Panel title="Record a check">
            <ActionForm action={recordProtectiveCheckAction} className="space-y-3">
              <FormGrid cols={2}>
                <Field label="Item"><NativeSelect name="itemId" required options={o.protective.map((p) => ({ value: p.i.id, label: p.i.label }))} placeholder="Choose an item…" /></Field>
                <Field label="Checked on"><Input type="date" name="checkedOn" required max={today} defaultValue={today} /></Field>
                <Field label="How"><Input name="method" maxLength={120} defaultValue="Visual and X-ray screened" /></Field>
                <Field label="Result"><Select name="result" required placeholder="Choose…" options={[{ value: "PASS", label: "Passed" }, { value: "FAIL", label: "Failed: cracks or holes" }]} /></Field>
                <Field label="Checked by"><Input name="checkedBy" required maxLength={120} defaultValue={me.name} /></Field>
              </FormGrid>
              <Field label="Notes"><Input name="notes" maxLength={1000} /></Field>
              <SubmitButton variant="secondary">Save check</SubmitButton>
            </ActionForm>
          </Panel>}
          {canEdit && tree && <Panel title="Add an item">
            <ActionForm action={addProtectiveItemAction} className="space-y-3">
              <input type="hidden" name="facilityId" value={facilityId} />
              <FormGrid cols={2}>
                <Field label="Kind"><Select name="kind" required defaultValue="APRON" options={PROTECTIVE_KINDS.map((k) => ({ value: k, label: PROTECTIVE_KIND_LABELS[k] }))} /></Field>
                <Field label="Label" hint="The number written on it."><Input name="label" required maxLength={160} placeholder="e.g. Apron 0.35 mm, No. 12" /></Field>
                <Field label="Room"><RoomSelect tree={tree} placeholder="No room" /></Field>
                <Field label="Department"><NativeSelect name="departmentId" options={tree.departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="No department" /></Field>
                <Field label="Check every (months)"><Input type="number" name="intervalMonths" min={1} max={60} defaultValue={12} /></Field>
              </FormGrid>
              <SubmitButton variant="secondary">Add item</SubmitButton>
            </ActionForm>
          </Panel>}
        </div>
      )}
    </>
  );
}

type Overview = Awaited<ReturnType<typeof radiationOverview>>;

function Dosimetry({ o, canEdit, facilityId, departments }: { o: Overview; canEdit: boolean; facilityId: number; departments: { id: number; name: string }[] }) {
  const { rows, note } = capRows(o.doses, 300, "readings");
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Badge readings for the last 12 months. Each reading is judged against the period&apos;s share of the annual limit ({ANNUAL_LIMIT_MSV} mSv); {Math.round(INVESTIGATION_SHARE * 100)} % of it is the investigation level. Only a name and a role are kept: no ID numbers.</p>
      {rows.length === 0 ? <EmptyState title="No badge readings in the last 12 months">Enter each person&apos;s reading when the dosimetry service sends the report.</EmptyState> : (
        <>
          {note && <p role="note" className="text-sm text-warn">{note}</p>}
          <Table>
            <THead><tr><Th>Person</Th><Th>Period</Th><Th className="text-right">Dose (mSv)</Th><Th className="text-right">Limit (mSv)</Th><Th>Flag</Th></tr></THead>
            <tbody>{rows.map(({ d, departmentName }) => (
              <tr key={d.id}>
                <Td><b>{d.personName}</b><span className="block text-xs text-muted">{[d.personRole, departmentName].filter(Boolean).join(" · ")}</span></Td>
                <Td className="whitespace-nowrap">{formatDate(d.periodStart)} to {formatDate(d.periodEnd)}</Td>
                <Td className="text-right">{formatNumber(d.doseMsv, 2)}</Td>
                <Td className="text-right">{formatNumber(d.limitMsv, 2)}</Td>
                <Td><Badge tone={DOSE_FLAG_TONE[d.flag as DoseFlag] ?? "neutral"}>{DOSE_FLAG_LABELS[d.flag as DoseFlag] ?? d.flag}</Badge>{d.notes && <span className="block max-w-xs text-xs text-muted">{d.notes}</span>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </>
      )}
      {canEdit && <Panel title="Record a badge reading">
        <ActionForm action={recordDoseAction} className="space-y-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <FormGrid cols={2}>
            <Field label="Name"><Input name="personName" required maxLength={120} /></Field>
            <Field label="Role"><Input name="personRole" maxLength={80} placeholder="e.g. Radiographer" /></Field>
            <Field label="Department"><NativeSelect name="departmentId" options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="No department" /></Field>
            <Field label="Dose (mSv)" hint="Effective dose, Hp(10)."><Input name="doseMsv" required inputMode="decimal" /></Field>
            <Field label="Period from"><Input type="date" name="periodStart" required /></Field>
            <Field label="Period to"><Input type="date" name="periodEnd" required /></Field>
            <Field label="Limit for the period (mSv)" hint="Leave blank to use the share of 20 mSv a year."><Input name="limitMsv" inputMode="decimal" /></Field>
          </FormGrid>
          <Field label="Notes"><Input name="notes" maxLength={1000} /></Field>
          <SubmitButton variant="secondary">Save reading</SubmitButton>
        </ActionForm>
      </Panel>}
    </div>
  );
}
