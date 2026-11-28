import Link from "next/link";
import { and, asc, count, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { assets, doseRecords, doseReviews, facilities } from "@/db/schema";
import { Badge, Button, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Stat, TabLinks, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { SubmitButton } from "@/components/ui/action-form";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import {
  AGE_GROUP_LABELS, AGE_GROUPS, DOSE_MODALITIES, DOSE_MODALITY_LABELS, DOSE_QUANTITIES, doseText, EXAMPLE_SOURCE, lastMonths, MIN_SAMPLE, MODALITY_QUANTITIES,
  QUANTITY_LABELS, QUANTITY_UNITS, reviewKey, type AgeGroup, type DoseModality, type DoseQuantity, type GroupCheck,
} from "@/lib/assets/patient-dose";
import { doseChecks, doseScanners, drlsFor, type DoseScanner, type DrlRow, type ReviewRow } from "@/lib/assets/patient-dose-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { pageFor, PAGE_SIZE, sqlOrder } from "@/lib/paging";
import { addExampleDrlsAction, deleteDoseRecordAction, importDoseAction, recordDoseAction, saveDoseReviewAction, saveDrlAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Patient dose" };

const TABS = ["check", "records", "add", "levels", "reviews"] as const;
type Params = Record<string, string | string[] | undefined>;
const STATE_LABEL = { above: "Above DRL: review", within: "Within DRL", no_drl: "No DRL" } as const;
const STATE_TONE = { above: "danger", within: "ok", no_drl: "neutral" } as const;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Patient dose against diagnostic reference levels (wave 43, GAHAR DAS.09; ICRP 135): the monthly median per exam
 * type and scanner compared with the hospital's DRL, the physicist's review of a median above it, the dose records
 * (entered or imported, with no patient names or IDs) and the DRL table.
 */
export default async function PatientDosePage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.id));
  const facilityId = scopedFacilityId(scope, Number(one("facilityId")) || null) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Patient dose" /><EmptyState title="No hospital to show">You don&apos;t have access to any hospital yet.</EmptyState></>;
  await requireFacilityAccess(facilityId, me);
  const tab = TABS.find((t) => t === one("tab")) ?? "check";
  const today = todayISO();
  const months = lastMonths(today, 12);
  const month = months.find((m) => m === one("month")) ?? months[0];
  const [scanners, drls, { checks, reviews }] = await Promise.all([
    doseScanners(scope, facilityId), drlsFor([facilityId]), doseChecks([facilityId], months.at(-1)!, months[0]),
  ]);
  const monthChecks = checks.filter((c) => c.month === month);
  const above = monthChecks.filter((c) => c.state === "above");
  const open = checks.filter((c) => c.state === "above" && !reviews.has(reviewKey(c))).length;
  const examples = drls.filter((d) => d.isExample && d.active).length;
  const href = (t: string, extra = "") => `/assets/patient-dose?facilityId=${facilityId}&tab=${t}${extra}`;
  const tags = new Map(scanners.map((s) => [s.id, s]));

  return (
    <>
      <PageHeader title="Patient dose" description="Patient dose per exam compared with diagnostic reference levels (DRLs, ICRP 135; GAHAR DAS.09). Each month the median dose of each exam type on each scanner is compared with the DRL; a median above it goes to the medical physicist for review. No patient names or IDs are kept." />
      <Notice sp={sp} />
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <input type="hidden" name="tab" value={tab} />
          <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      {examples > 0 && <p role="status" className="mb-4 rounded-[var(--radius-control)] border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">{examples} reference levels are examples. Replace them with national or local DRLs on the <Link href={href("levels")} className="underline">Reference levels</Link> tab.</p>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="X-ray scanners" value={formatNumber(scanners.length)} />
        <Stat label={`Exam groups in ${monthLabel(month)}`} value={formatNumber(monthChecks.length)} hint={`${formatNumber(monthChecks.filter((c) => c.state === "no_drl").length)} without a DRL`} href={href("check", `&month=${month}`)} />
        <Stat label="Above DRL this month" value={formatNumber(above.length)} href={href("check", `&month=${month}`)} />
        <Stat label="Waiting for review (12 months)" value={formatNumber(open)} href={href("reviews")} />
      </div>
      <TabLinks active={tab} tabs={[
        { key: "check", label: "Monthly check", href: href("check") }, { key: "records", label: "Dose records", href: href("records") },
        { key: "add", label: "Enter or import", href: href("add") }, { key: "levels", label: `Reference levels (${drls.length})`, href: href("levels") },
        { key: "reviews", label: "Reviews", href: href("reviews") },
      ]} />
      {tab === "check" && <Check facilityId={facilityId} month={month} months={months} rows={monthChecks} reviews={reviews} tags={tags} canReview={can(me.role, "incidents.manage")} today={today} />}
      {tab === "records" && <Records facilityId={facilityId} sp={sp} tags={tags} canDelete={can(me.role, "catalogue.edit")} />}
      {tab === "add" && <Add facilityId={facilityId} scanners={scanners} canRecord={can(me.role, "maintenance.edit")} today={today} />}
      {tab === "levels" && <Levels facilityId={facilityId} drls={drls} canEdit={can(me.role, "catalogue.edit")} />}
      {tab === "reviews" && <Reviews facilityId={facilityId} checks={checks} reviews={reviews} tags={tags} />}
    </>
  );
}

function figuresText(c: GroupCheck) {
  return c.checks.map((x) => `${QUANTITY_LABELS[x.quantity]} median ${doseText(x.quantity, x.median)}${x.drl != null ? ` (DRL ${doseText(x.quantity, x.drl)})` : ""}`).join("; ") + ` — ${c.n} exams`;
}

function Check({ facilityId, month, months, rows, reviews, tags, canReview, today }: {
  facilityId: number; month: string; months: string[]; rows: GroupCheck[]; reviews: Map<string, ReviewRow>; tags: Map<number, DoseScanner>; canReview: boolean; today: string;
}) {
  return (
    <div className="space-y-5">
      <form className="flex flex-wrap items-end gap-2">
        <AutoSubmit />
        <input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="tab" value="check" />
        <label><span className="sr-only">Month</span><NativeSelect name="month" aria-label="Month" value={month} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} /></label>
        <Button variant="secondary">Show</Button>
      </form>
      {rows.length === 0 ? <EmptyState title={`No dose records in ${monthLabel(month)}`}>Enter exams or import the month&apos;s export from the RIS or dose system on the Enter or import tab.</EmptyState> : (
        <Table>
          <THead><tr><Th>Scanner</Th><Th>Exam type</Th><Th className="text-right">Exams</Th><Th>Median against DRL</Th><Th>Result</Th></tr></THead>
          <tbody>{rows.map((c) => {
            const rev = reviews.get(reviewKey(c)), s = tags.get(c.assetId);
            return (
              <tr key={reviewKey(c)}>
                <Td><Link href={`/assets/${c.assetId}`} className="font-mono text-sm font-semibold text-primary hover:underline">{s?.tag ?? c.assetId}</Link><span className="block text-xs text-muted">{DOSE_MODALITY_LABELS[c.modality]}</span></Td>
                <Td>{c.examType}<span className="block text-xs text-muted">{AGE_GROUP_LABELS[c.ageGroup]}</span></Td>
                <Td className="text-right">{c.n}{c.smallSample && <span className="block text-xs text-muted">Under {MIN_SAMPLE[c.modality]}: small sample</span>}</Td>
                <Td className="text-sm">{c.checks.map((x) => (
                  <span key={x.quantity} className={`block ${x.state === "above" ? "text-danger" : ""}`}>{QUANTITY_LABELS[x.quantity]}: {doseText(x.quantity, x.median)}{x.drl != null ? ` of ${doseText(x.quantity, x.drl)} (${formatNumber((x.ratio ?? 0) * 100)} %)` : " — no DRL"}</span>
                ))}</Td>
                <Td>
                  <Badge tone={c.state === "above" && rev ? "warn" : STATE_TONE[c.state]}>{c.state === "above" && rev ? "Above DRL: reviewed" : STATE_LABEL[c.state]}</Badge>
                  {rev && <span className="mt-1 block text-xs text-muted">{rev.reviewedByName}, {formatDate(rev.reviewedOn)}: {rev.action}</span>}
                  {c.state === "above" && canReview && (
                    <details className="mt-2"><summary className="cursor-pointer text-sm text-primary">{rev ? "Change the review" : "Record the physicist's review"}</summary>
                      <ActionForm action={saveDoseReviewAction} className="mt-2 space-y-2">
                        <input type="hidden" name="assetId" value={c.assetId} /><input type="hidden" name="modality" value={c.modality} /><input type="hidden" name="examType" value={c.examType} />
                        <input type="hidden" name="ageGroup" value={c.ageGroup} /><input type="hidden" name="month" value={c.month} /><input type="hidden" name="figures" value={figuresText(c).slice(0, 500)} />
                        <Field label="What was found" hint="Protocol, technique, patient size, equipment."><Textarea name="findings" rows={2} required defaultValue={rev?.findings ?? ""} /></Field>
                        <Field label="Action taken"><Textarea name="action" rows={2} required defaultValue={rev?.action ?? ""} placeholder="e.g. protocol changed, staff retrained, no change needed (justified)" /></Field>
                        <Field label="Review date"><Input type="date" name="reviewedOn" defaultValue={rev?.reviewedOn ?? today} max={today} /></Field>
                        <SubmitButton variant="secondary">Save the review</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
      <Panel title="How the check works">
        <p className="text-sm text-muted">A DRL is not a limit for one patient. Each month, the median of each exam type on each scanner (per age group) is compared with the hospital&apos;s DRL for that exam. A median above the DRL is flagged for the medical physicist, who records what was found and the action. ICRP 135 suggests at least {MIN_SAMPLE.CT} exams for the median ({MIN_SAMPLE.MAMMO} for mammography); smaller samples are shown but read with care.</p>
      </Panel>
    </div>
  );
}

const RECORD_SORTS = ["date", "exam"] as const;

async function Records({ facilityId, sp, tags, canDelete }: { facilityId: number; sp: Params; tags: Map<number, DoseScanner>; canDelete: boolean }) {
  const where = eq(doseRecords.facilityId, facilityId);
  const sort = tableSort(sp, RECORD_SORTS, { key: "date", dir: "desc" });
  const [{ n }] = await db.select({ n: count() }).from(doseRecords).where(where);
  const pg = pageFor(sp, n, PAGE_SIZE);
  const rows = await db.select().from(doseRecords).where(where)
    .orderBy(...sqlOrder(sort, { date: doseRecords.examDate, exam: doseRecords.examType }, [desc(doseRecords.examDate)], [desc(doseRecords.id)])).limit(pg.size).offset(pg.offset);
  type R = (typeof rows)[number];
  const value = (r: R, q: DoseQuantity) => (q === "time" ? r.fluoroTime : r[q]);
  const columns: Column<R>[] = [
    { key: "date", label: "Exam date", sort: true, className: "whitespace-nowrap", cell: (r) => formatDate(r.examDate) },
    { key: "scanner", label: "Scanner", cell: (r) => <Link href={`/assets/${r.assetId}`} className="font-mono text-sm text-primary hover:underline">{tags.get(r.assetId)?.tag ?? r.assetId}</Link> },
    { key: "exam", label: "Exam type", sort: true, cell: (r) => <>{r.examType}{r.protocol && <span className="block text-xs text-muted">{r.protocol}</span>}</> },
    { key: "age", label: "Age group", cell: (r) => AGE_GROUP_LABELS[r.ageGroup as AgeGroup] ?? r.ageGroup },
    { key: "dose", label: "Dose", cell: (r) => <span className="text-sm">{MODALITY_QUANTITIES[r.modality as DoseModality]?.filter((q) => value(r, q) != null).map((q) => `${QUANTITY_LABELS[q]} ${doseText(q, value(r, q))}`).join(" · ")}</span> },
    { key: "source", label: "Source", optional: true, cell: (r) => <span className="text-xs text-muted">{r.source === "IMPORT" ? `Imported${r.importFile ? ` (${r.importFile})` : ""}` : "Entered"}{r.enteredByName ? ` by ${r.enteredByName}` : ""}</span> },
    ...(canDelete ? [{ key: "remove", label: "Remove", head: <span className="sr-only">Remove</span>, cell: (r: R) => (
      <ActionForm action={deleteDoseRecordAction} confirm="Remove this dose record?"><input type="hidden" name="id" value={r.id} /><SubmitButton variant="ghost">Remove</SubmitButton></ActionForm>
    ) }] : []),
  ];
  return (
    <DataTable id="dose-records" label="Dose records" path="/assets/patient-dose" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.id} columns={columns}
      empty={<EmptyState title="No dose records yet">Enter exams or import an export from the RIS or dose system on the Enter or import tab.</EmptyState>}
      footer={<ListPager paging={pg} path="/assets/patient-dose" sp={sp} what="exams" />} />
  );
}

function Add({ facilityId, scanners, canRecord, today }: { facilityId: number; scanners: DoseScanner[]; canRecord: boolean; today: string }) {
  if (!canRecord) return <EmptyState title="Recording dose needs maintenance access">Ask biomedical engineering or an imaging technologist&apos;s account to enter dose records.</EmptyState>;
  if (!scanners.length) return <EmptyState title="No X-ray devices in this hospital">CT, X-ray, fluoroscopy and mammography devices in the register appear here.</EmptyState>;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Import from the RIS or dose system">
        <p className="mb-3 text-sm text-muted">Upload a CSV with one exam per row. Columns: <b>Date</b>, <b>Scanner</b> (asset tag, serial or AE title), <b>Exam type</b>, and any of Protocol, Age (years or group), CTDIvol, DLP, DAP, ESD, Fluoro time, AGD. Units can be given in the heading, e.g. &quot;DAP (mGy·cm²)&quot; or &quot;Time (s)&quot;. A file with patient names, IDs, MRN, accession numbers or birth dates is refused: remove those columns first. If any row can&apos;t be read, nothing is saved.</p>
        <ActionForm action={importDoseAction} className="space-y-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field label="CSV file"><Input type="file" name="file" accept=".csv" required /></Field>
          <SubmitButton>Import exams</SubmitButton>
        </ActionForm>
      </Panel>
      <Panel title="Enter one exam">
        <ActionForm action={recordDoseAction} className="space-y-3">
          <FormGrid cols={2}>
            <Field label="Scanner"><NativeSelect name="assetId" required placeholder="Choose" options={scanners.map((s) => ({ value: s.id, label: `${s.tag} · ${DOSE_MODALITY_LABELS[s.modality]}` }))} /></Field>
            <Field label="Exam date"><Input type="date" name="examDate" required defaultValue={today} max={today} /></Field>
            <Field label="Exam type"><Input name="examType" required maxLength={160} placeholder="e.g. CT head" /></Field>
            <Field label="Protocol"><Input name="protocol" maxLength={160} /></Field>
            <Field label="Age group"><NativeSelect name="ageGroup" value="ADULT" options={AGE_GROUPS.map((a) => ({ value: a, label: AGE_GROUP_LABELS[a] }))} /></Field>
          </FormGrid>
          <p className="text-xs text-muted">Fill the values the scanner&apos;s modality records; the others are ignored.</p>
          <FormGrid cols={3}>
            {DOSE_QUANTITIES.map((q) => <Field key={q} label={`${QUANTITY_LABELS[q]} (${QUANTITY_UNITS[q]})`} hint={DOSE_MODALITIES.filter((m) => MODALITY_QUANTITIES[m].includes(q)).map((m) => DOSE_MODALITY_LABELS[m]).join(", ")}><Input type="number" name={q} min={0} step="any" /></Field>)}
          </FormGrid>
          <SubmitButton variant="secondary">Save the exam</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}

function DrlForm({ facilityId, d }: { facilityId: number; d?: DrlRow }) {
  return (
    <ActionForm action={saveDrlAction} className="space-y-3">
      <input type="hidden" name="facilityId" value={facilityId} />{d && <input type="hidden" name="id" value={d.id} />}
      <FormGrid cols={3}>
        <Field label="Modality"><NativeSelect name="modality" required value={d?.modality ?? "CT"} options={DOSE_MODALITIES.map((m) => ({ value: m, label: DOSE_MODALITY_LABELS[m] }))} /></Field>
        <Field label="Exam type"><Input name="examType" required maxLength={160} defaultValue={d?.examType} placeholder="As named in the RIS" /></Field>
        <Field label="Age group"><NativeSelect name="ageGroup" value={d?.ageGroup ?? "ADULT"} options={AGE_GROUPS.map((a) => ({ value: a, label: AGE_GROUP_LABELS[a] }))} /></Field>
        <Field label="Dose quantity"><NativeSelect name="quantity" required value={d?.quantity ?? "ctdivol"} options={DOSE_QUANTITIES.map((q) => ({ value: q, label: `${QUANTITY_LABELS[q]} (${QUANTITY_UNITS[q]})` }))} /></Field>
        <Field label="DRL value"><Input type="number" name="value" required min={0} step="any" defaultValue={d?.value} /></Field>
        <Field label="Year"><Input type="number" name="sourceYear" min={1990} max={2100} defaultValue={d?.sourceYear ?? undefined} /></Field>
      </FormGrid>
      <Field label="Source" hint="National DRL, local survey of this hospital, or the publication."><Input name="source" required maxLength={300} defaultValue={d && !d.isExample ? d.source : ""} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={d ? d.active : true} className="size-5" /> In use</label>
      <SubmitButton variant="secondary">{d ? "Save the level" : "Add the level"}</SubmitButton>
    </ActionForm>
  );
}

function Levels({ facilityId, drls, canEdit }: { facilityId: number; drls: DrlRow[]; canEdit: boolean }) {
  return (
    <div className="space-y-5">
      {drls.length === 0 ? <EmptyState title="No reference levels yet">{canEdit ? "Enter your national or local DRLs below, or add the example rows to start and replace them." : "Ask biomedical engineering or the physicist to enter the DRLs."}</EmptyState> : (
        <Table>
          <THead><tr><Th>Exam type</Th><Th>Age group</Th><Th>Quantity</Th><Th className="text-right">DRL</Th><Th>Source</Th>{canEdit && <Th><span className="sr-only">Edit</span></Th>}</tr></THead>
          <tbody>{drls.map((d) => (
            <tr key={d.id} className={d.active ? undefined : "text-muted"}>
              <Td>{d.examType}<span className="block text-xs text-muted">{DOSE_MODALITY_LABELS[d.modality as DoseModality] ?? d.modality}</span></Td>
              <Td className="text-sm">{AGE_GROUP_LABELS[d.ageGroup as AgeGroup] ?? d.ageGroup}</Td>
              <Td className="text-sm">{QUANTITY_LABELS[d.quantity as DoseQuantity] ?? d.quantity}</Td>
              <Td className="text-right whitespace-nowrap">{doseText(d.quantity as DoseQuantity, d.value)}</Td>
              <Td className="text-sm">{d.isExample ? <Badge tone="warn">{EXAMPLE_SOURCE}</Badge> : <>{d.source}{d.sourceYear ? ` (${d.sourceYear})` : ""}</>}{!d.active && <Badge tone="neutral">Not in use</Badge>}</Td>
              {canEdit && <Td><details><summary className="cursor-pointer text-sm text-primary">Edit</summary><div className="mt-2 min-w-80"><DrlForm facilityId={facilityId} d={d} /></div></details></Td>}
            </tr>
          ))}</tbody>
        </Table>
      )}
      {canEdit && (
        <>
          <Panel title="New reference level"><DrlForm facilityId={facilityId} /></Panel>
          <ActionForm action={addExampleDrlsAction}>
            <input type="hidden" name="facilityId" value={facilityId} />
            <SubmitButton variant="secondary">Add example levels</SubmitButton>
            <p className="mt-1 text-xs text-muted">Rounded adult figures to start the table. They are not Egyptian DRLs: each is marked &quot;{EXAMPLE_SOURCE}&quot;.</p>
          </ActionForm>
        </>
      )}
    </div>
  );
}

async function Reviews({ facilityId, checks, reviews, tags }: { facilityId: number; checks: GroupCheck[]; reviews: Map<string, ReviewRow>; tags: Map<number, DoseScanner> }) {
  const waiting = checks.filter((c) => c.state === "above" && !reviews.has(reviewKey(c)));
  const done = await db.select({ r: doseReviews, tag: assets.assetTag }).from(doseReviews).innerJoin(assets, eq(assets.id, doseReviews.assetId))
    .where(and(eq(doseReviews.facilityId, facilityId), gte(doseReviews.month, lastMonths(todayISO(), 24).at(-1)!))).orderBy(desc(doseReviews.month), desc(doseReviews.reviewedOn)).limit(500);
  return (
    <div className="space-y-5">
      <Panel title={`Waiting for the physicist (${waiting.length})`} padded={waiting.length === 0}>
        {waiting.length === 0 ? <p className="text-sm text-muted">Every median above its DRL in the last 12 months has a review.</p> : (
          <Table>
            <THead><tr><Th>Month</Th><Th>Scanner</Th><Th>Exam type</Th><Th>Medians</Th></tr></THead>
            <tbody>{waiting.map((c) => (
              <tr key={reviewKey(c)}>
                <Td><Link href={`/assets/patient-dose?facilityId=${facilityId}&tab=check&month=${c.month}`} className="text-primary hover:underline">{monthLabel(c.month)}</Link></Td>
                <Td className="font-mono text-sm">{tags.get(c.assetId)?.tag ?? c.assetId}</Td><Td>{c.examType}<span className="block text-xs text-muted">{AGE_GROUP_LABELS[c.ageGroup]}</span></Td>
                <Td className="text-sm">{figuresText(c)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
      <Panel title="Reviews recorded" padded={done.length === 0}>
        {done.length === 0 ? <p className="text-sm text-muted">No reviews yet.</p> : (
          <Table>
            <THead><tr><Th>Month</Th><Th>Scanner</Th><Th>Exam type</Th><Th>Found</Th><Th>Action</Th><Th>Reviewed</Th></tr></THead>
            <tbody>{done.map(({ r, tag }) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{monthLabel(r.month)}</Td><Td><Link href={`/assets/${r.assetId}`} className="font-mono text-sm text-primary hover:underline">{tag}</Link></Td>
                <Td>{r.examType}{r.figures && <span className="block text-xs text-muted">{r.figures}</span>}</Td>
                <Td className="whitespace-pre-wrap text-sm">{r.findings}</Td><Td className="whitespace-pre-wrap text-sm">{r.action}</Td>
                <Td className="text-sm">{r.reviewedByName}<span className="block text-xs text-muted">{formatDate(r.reviewedOn)}</span></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
