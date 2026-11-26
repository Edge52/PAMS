import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets, facilities, imagingQcRecords, imagingQcTemplates, workOrders } from "@/db/schema";
import { Badge, Button, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Stat, TabLinks, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { SubmitButton } from "@/components/ui/action-form";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { QcTrend } from "@/components/assets/qc-trend";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import {
  DUE_LABELS, DUE_TONE, FREQUENCIES, FREQUENCY_LABELS, itemsText, limitText, MODALITIES, MODALITY_LABELS, REVIEWER_ROLE_LABELS, REVIEWER_ROLES, reviewMonths, trend,
  type Frequency, type Modality, type ReviewerRole,
} from "@/lib/assets/imaging-qc";
import { qcDueList, qcMonth } from "@/lib/assets/imaging-qc-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatNumber, todayISO } from "@/lib/format";
import { addExampleTemplatesAction, openQcWorkOrderAction, saveTemplateAction, signQcReviewAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Imaging QC" };

const TABS = ["due", "records", "review", "trend", "templates"] as const;

/**
 * Routine imaging QC by technologists (wave 40, GAHAR DAS.05): what is due per scanner, the runs, the monthly review
 * by the radiologist or physicist, the trend of a measured item, and the templates. The physicist's yearly QC is on
 * Radiation safety.
 */
export default async function ImagingQcPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.id));
  const facilityId = scopedFacilityId(scope, Number(one("facilityId")) || null) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Imaging QC" /><EmptyState title="No hospital to show">You don&apos;t have access to any hospital yet.</EmptyState></>;
  await requireFacilityAccess(facilityId, me);
  const tab = TABS.find((t) => t === one("tab")) ?? "due";
  const today = todayISO();
  const canTemplates = can(me.role, "catalogue.edit"), canRecord = can(me.role, "workorders.report");
  const due = await qcDueList(facilityId, today);
  const href = (t: string, extra = "") => `/assets/imaging-qc?facilityId=${facilityId}&tab=${t}${extra}`;
  const late = due.rows.filter((r) => r.state === "overdue" || r.state === "never").length;
  const now = due.rows.filter((r) => r.state === "due").length;
  const recent = tab === "records" || tab === "due" ? await db.select({ q: imagingQcRecords, name: imagingQcTemplates.name, tag: assets.assetTag, woNumber: workOrders.number })
    .from(imagingQcRecords).innerJoin(imagingQcTemplates, eq(imagingQcTemplates.id, imagingQcRecords.templateId)).innerJoin(assets, eq(assets.id, imagingQcRecords.assetId))
    .leftJoin(workOrders, eq(workOrders.id, imagingQcRecords.workOrderId)).where(eq(imagingQcRecords.facilityId, facilityId))
    .orderBy(desc(imagingQcRecords.performedOn), desc(imagingQcRecords.id)).limit(100) : [];
  const failedOpen = recent.filter((r) => !r.q.passed && !r.q.workOrderId).length;
  const months = reviewMonths(today);
  const month = months.find((m) => m === one("month")) ?? months[0];

  return (
    <>
      <PageHeader title="Imaging QC" description="Routine quality control by the technologists on each scanner (GAHAR DAS.05): daily, weekly and monthly checks, failed checks to work orders, and the monthly review by the radiologist or physicist. The physicist's yearly tests are on Radiation safety." />
      <Notice sp={sp} />
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <input type="hidden" name="tab" value={tab} />
          <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Scanners" value={formatNumber(due.scanners.length)} hint={`${due.templates.length} templates in use`} />
        <Stat label="Missed or never done" value={formatNumber(late)} href={href("due")} />
        <Stat label="Due now" value={formatNumber(now)} href={href("due")} />
        <Stat label="Failed runs without a job" value={formatNumber(failedOpen)} hint="Latest 100 runs" href={href("records")} />
      </div>
      <TabLinks active={tab} tabs={[
        { key: "due", label: "Due", href: href("due") }, { key: "records", label: "Runs", href: href("records") }, { key: "review", label: "Monthly review", href: href("review") },
        { key: "trend", label: "Trend", href: href("trend") }, { key: "templates", label: `Templates (${due.templates.length})`, href: href("templates") },
      ]} />

      {tab === "due" && (due.templates.length === 0 ? (
        <EmptyState title="No QC templates yet">{canTemplates ? "Add the example templates on the Templates tab, then adapt them to your scanners and phantoms." : "Ask biomedical engineering to set up the QC templates."}</EmptyState>
      ) : due.rows.length === 0 ? (
        <EmptyState title="No scanners with a template">CT, MRI, X-ray, mammography, fluoroscopy, C-arm and ultrasound devices in the register appear here when a template exists for their modality.</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Scanner</Th><Th>Template</Th><Th>Last run</Th><Th>State</Th>{canRecord && <Th><span className="sr-only">Record</span></Th>}</tr></THead>
          <tbody>{due.rows.map((r) => (
            <tr key={`${r.scanner.id}:${r.template.id}`}>
              <Td><Link href={`/assets/${r.scanner.id}`} className="font-mono text-sm text-primary hover:underline">{r.scanner.tag}</Link><span className="block text-xs text-muted">{r.scanner.typeName}{r.scanner.departmentName ? ` · ${r.scanner.departmentName}` : ""}</span></Td>
              <Td>{r.template.name}<span className="block text-xs text-muted">{FREQUENCY_LABELS[r.template.frequency as Frequency]}</span></Td>
              <Td className="whitespace-nowrap">{r.lastOn ? <>{formatDate(r.lastOn)} {r.lastPassed === false && <Badge tone="danger">Failed</Badge>}</> : <span className="text-muted">Never</span>}</Td>
              <Td><Badge tone={DUE_TONE[r.state]}>{DUE_LABELS[r.state]}</Badge></Td>
              {canRecord && <Td><LinkButton variant="secondary" href={`/assets/imaging-qc/record?assetId=${r.scanner.id}&templateId=${r.template.id}`}>Record</LinkButton></Td>}
            </tr>
          ))}</tbody>
        </Table>
      ))}

      {tab === "records" && (recent.length === 0 ? <EmptyState title="No QC runs yet">Record a run from the Due tab.</EmptyState> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>Scanner</Th><Th>Template</Th><Th>Result</Th><Th>Work order</Th></tr></THead>
          <tbody>{recent.map(({ q, name, tag, woNumber }) => (
            <tr key={q.id} id={`qc-${q.id}`} className={String(q.id) === one("recordId") ? "bg-warn-soft" : undefined}>
              <Td className="whitespace-nowrap">{formatDate(q.performedOn)}<span className="block text-xs text-muted">{q.performedByName}</span></Td>
              <Td><Link href={`/assets/${q.assetId}`} className="font-mono text-sm text-primary hover:underline">{tag}</Link></Td>
              <Td className="text-sm">{name}{!q.passed && <ul className="mt-1 text-xs text-danger">{q.answers.filter((a) => a.result === "FAIL").map((a) => <li key={a.label}>{a.label}{a.value != null ? `: ${a.value}` : ""}</li>)}</ul>}{q.notes && <span className="block text-xs text-muted">{q.notes}</span>}</Td>
              <Td><Badge tone={q.passed ? "ok" : "danger"}>{q.passed ? "Passed" : `${q.failedCount} failed`}</Badge></Td>
              <Td>{q.workOrderId ? <Link href={`/assets/work-orders/${q.workOrderId}`} className="font-mono text-sm text-primary hover:underline">{woNumber}</Link> : !q.passed && canRecord ? (
                <ActionForm action={openQcWorkOrderAction}><input type="hidden" name="recordId" value={q.id} /><Button variant="secondary">Open a work order</Button></ActionForm>
              ) : <span className="text-muted">—</span>}</Td>
            </tr>
          ))}</tbody>
        </Table>
      ))}

      {tab === "review" && <Review facilityId={facilityId} month={month} months={months} today={today} me={me} />}
      {tab === "trend" && <Trend facilityId={facilityId} scanners={due.scanners} assetId={Number(one("assetId")) || undefined} item={one("item")} />}

      {tab === "templates" && (
        <div className="space-y-5">
          <p className="text-sm text-muted">One item per line: <code>name | unit | min | max</code> for a measured value, or just the name for pass or fail. Example templates are generic starting points: adapt them to your scanners, phantoms and the maker&apos;s figures. Saving a template takes off its example mark.</p>
          {canTemplates && (
            <ActionForm action={addExampleTemplatesAction}><input type="hidden" name="facilityId" value={facilityId} /><Button variant="secondary">Add the example templates</Button></ActionForm>
          )}
          <Templates facilityId={facilityId} canEdit={canTemplates} />
        </div>
      )}
    </>
  );
}

async function Templates({ facilityId, canEdit }: { facilityId: number; canEdit: boolean }) {
  const list = await db.select().from(imagingQcTemplates).where(eq(imagingQcTemplates.facilityId, facilityId)).orderBy(asc(imagingQcTemplates.modality), asc(imagingQcTemplates.name));
  const form = (t?: typeof list[number]) => (
    <ActionForm action={saveTemplateAction} className="space-y-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      {t && <input type="hidden" name="id" value={t.id} />}
      <FormGrid cols={3}>
        <Field label="Name"><Input name="name" required maxLength={160} defaultValue={t?.name.replace(/\s*\(example\)$/, "") ?? ""} /></Field>
        <Field label="Modality"><NativeSelect name="modality" required value={t?.modality} options={MODALITIES.map((m) => ({ value: m, label: MODALITY_LABELS[m] }))} placeholder="Choose…" /></Field>
        <Field label="How often"><NativeSelect name="frequency" required value={t?.frequency ?? "DAILY"} options={FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }))} /></Field>
      </FormGrid>
      <Field label="Items"><Textarea name="items" rows={6} required defaultValue={t ? itemsText(t.items) : ""} className="font-mono text-[13px]" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={t ? t.active : true} className="size-5" /> In use</label>
      <SubmitButton variant="secondary">{t ? "Save template" : "Add template"}</SubmitButton>
    </ActionForm>
  );
  return (
    <>
      {list.length === 0 ? <EmptyState title="No templates">Add the example templates, or write your own below.</EmptyState> : list.map((t) => (
        <Panel key={t.id} title={<span className="flex flex-wrap items-center gap-2">{t.name}{t.isExample && <Badge tone="warn">Example: adapt before use</Badge>}{!t.active && <Badge tone="neutral">Not in use</Badge>}</span>}>
          <p className="mb-2 text-sm text-muted">{MODALITY_LABELS[t.modality as Modality]} · {FREQUENCY_LABELS[t.frequency as Frequency]}</p>
          <ul className="mb-3 list-inside list-disc text-sm">{t.items.map((i) => <li key={i.label}>{i.label} <span className="text-xs text-muted">({limitText(i)})</span></li>)}</ul>
          {canEdit && <details><summary className="cursor-pointer text-sm text-primary">Edit</summary><div className="mt-3">{form(t)}</div></details>}
        </Panel>
      ))}
      {canEdit && <Panel title="New template">{form()}</Panel>}
    </>
  );
}

async function Review({ facilityId, month, months, today, me }: { facilityId: number; month: string; months: string[]; today: string; me: { role: string } }) {
  const depts = await qcMonth(facilityId, month, today);
  const canSign = can(me.role, "incidents.manage") || me.role === "DEPARTMENT_HEAD";
  return (
    <div className="space-y-5">
      <form className="flex flex-wrap items-end gap-2">
        <AutoSubmit />
        <input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="tab" value="review" />
        <label><span className="sr-only">Month</span><NativeSelect name="month" aria-label="Month" value={month} options={months.map((m) => ({ value: m, label: m }))} /></label>
        <Button variant="secondary">Show</Button>
      </form>
      {depts.length === 0 ? <EmptyState title="Nothing to review">Departments appear here when their scanners have QC templates.</EmptyState> : depts.map((d) => (
        <Panel key={d.id ?? "none"} title={<span className="flex flex-wrap items-center gap-2">{d.name} {d.review ? <Badge tone="ok">Signed</Badge> : <Badge tone="warn">Not signed</Badge>}</span>}>
          <Table>
            <THead><tr><Th>Scanner</Th><Th>Template</Th><Th className="text-right">Runs</Th><Th className="text-right">Failed</Th><Th className="text-right">Missed periods</Th></tr></THead>
            <tbody>{d.lines.map((l) => (
              <tr key={`${l.tag}:${l.template}`}><Td className="font-mono text-sm">{l.tag}</Td><Td className="text-sm">{l.template}</Td><Td className="text-right">{l.runs}</Td>
                <Td className={`text-right ${l.failed ? "text-danger" : ""}`}>{l.failed}</Td><Td className={`text-right ${l.missed ? "text-warn" : ""}`}>{l.missed}</Td></tr>
            ))}</tbody>
          </Table>
          {d.review ? (
            <p className="mt-3 text-sm">Signed by <b>{d.review.signedByName}</b> ({REVIEWER_ROLE_LABELS[d.review.reviewerRole as ReviewerRole] ?? d.review.reviewerRole}) on {formatDateTime(d.review.signedAt)}.{d.review.comments && <span className="mt-1 block whitespace-pre-wrap text-muted">{d.review.comments}</span>}</p>
          ) : canSign && d.id != null ? (
            <ActionForm action={signQcReviewAction} className="mt-4 space-y-3">
              <input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="departmentId" value={d.id} /><input type="hidden" name="month" value={month} />
              <FormGrid cols={2}><Field label="Signing as"><NativeSelect name="reviewerRole" value="RADIOLOGIST" options={REVIEWER_ROLES.map((r) => ({ value: r, label: REVIEWER_ROLE_LABELS[r] }))} /></Field></FormGrid>
              <Field label="Comments" hint="Required when runs failed or were missed: say what was done."><Textarea name="comments" rows={2} /></Field>
              <SubmitButton variant="secondary">Sign the review</SubmitButton>
            </ActionForm>
          ) : <p className="mt-3 text-sm text-muted">The radiologist or physicist responsible signs this (biomedical engineering or the department head&apos;s account).</p>}
        </Panel>
      ))}
    </div>
  );
}

async function Trend({ facilityId, scanners, assetId, item }: { facilityId: number; scanners: { id: number; tag: string; typeName: string }[]; assetId?: number; item?: string }) {
  const chosen = scanners.find((s) => s.id === assetId) ?? scanners[0];
  const recs = chosen ? await db.select({ performedOn: imagingQcRecords.performedOn, items: imagingQcRecords.items, answers: imagingQcRecords.answers }).from(imagingQcRecords)
    .where(and(eq(imagingQcRecords.facilityId, facilityId), inArray(imagingQcRecords.assetId, [chosen.id]))).orderBy(desc(imagingQcRecords.performedOn)).limit(400) : [];
  const labels = [...new Set(recs.flatMap((r) => r.items.filter((i) => i.kind === "VALUE").map((i) => i.label)))];
  const label = labels.find((l) => l === item) ?? labels[0];
  const t = label ? trend(recs, label) : null;
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="tab" value="trend" />
        <label><span className="sr-only">Scanner</span><NativeSelect name="assetId" aria-label="Scanner" value={chosen?.id} options={scanners.map((s) => ({ value: s.id, label: `${s.tag} — ${s.typeName}` }))} /></label>
        {labels.length > 0 && <label><span className="sr-only">Item</span><NativeSelect name="item" aria-label="Item" value={label} options={labels.map((l) => ({ value: l, label: l }))} /></label>}
        <Button variant="secondary">Show</Button>
      </form>
      {!chosen ? <EmptyState title="No scanners">Scanners with a QC modality appear here.</EmptyState> : !t ? <p className="text-sm text-muted">No measured items recorded on {chosen.tag} yet.</p> : (
        <Panel title={`${chosen.tag}: ${label}`}>
          <QcTrend points={t.points} min={t.min} max={t.max} unit={t.unit} label={label!} />
          <p className="mt-2 text-sm text-muted">{t.points.length} readings{t.points.length ? `, last ${t.points.at(-1)!.value}${t.unit ? ` ${t.unit}` : ""} on ${formatDate(t.points.at(-1)!.on)}` : ""}.</p>
        </Panel>
      )}
    </div>
  );
}
