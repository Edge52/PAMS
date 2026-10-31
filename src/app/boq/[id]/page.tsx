import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { departments, facilities, projects } from "@/db/schema";
import { Button, LinkButton, PageHeader, Panel, Stat, StatusBadge, TabLinks } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { Notice } from "@/components/boq/notice";
import { ByDepartmentTab } from "@/components/boq/tabs/by-department";
import { ByDeviceTab } from "@/components/boq/tabs/by-device";
import { ScopeTab } from "@/components/boq/tabs/scope";
import { GapTab } from "@/components/boq/tabs/gap";
import { AssumptionsTab } from "@/components/boq/tabs/assumptions";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { departmentTypeList, getBoqWorkspace, installedCounts, level3DeviceOptions, rulesForSet } from "@/lib/boq/queries";
import { createNewVersion, deleteBoq, regenerate, submitBoqForApproval, withdrawBoqFromReview } from "../actions";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";
import { ApprovalPanel } from "@/components/approvals/approval-panel";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "department", label: "By department" },
  { key: "device", label: "By device type" },
  { key: "scope", label: "Departments" },
  { key: "gap", label: "Plan vs installed" },
  { key: "assumptions", label: "Assumptions" },
  { key: "history", label: "History & files" },
] as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = Number(id) ? await getBoqWorkspace(Number(id)) : null;
  return { title: ws ? ws.boq.name : "BOQ" };
}

export default async function BoqPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; why?: string; regen?: string; notice?: string; error?: string }>;
}) {
  const me = await requirePermission("boq.view");
  const { id } = await params;
  const sp = await searchParams;
  const boqId = Number(id);
  if (!Number.isInteger(boqId) || boqId <= 0) notFound();
  const ws = await getBoqWorkspace(boqId);
  if (!ws) notFound();
  const { boq, totals } = ws;
  await requireFacilityAccess(boq.facilityId, me);
  const mayEdit = can(me.role, "boq.edit");
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "department") as (typeof TABS)[number]["key"];
  const statusLocked = boq.status === "APPROVED" || boq.status === "SUPERSEDED" || boq.status === "UNDER_REVIEW";
  // Read-only for roles that can't edit BOQs (the tabs hide their edit controls when locked).
  const locked = statusLocked || !mayEdit;
  const cur = boq.currency;
  const regenSummary = sp.regen ? (await getActivity("boq", boqId, 5)).find((a) => a.action === "regenerated")?.summary : null;
  const units = ws.lines.reduce((s, l) => s + l.quantity, 0);
  const overrides = ws.lines.filter((l) => l.isOverridden).length;
  const manual = ws.lines.filter((l) => l.isManual).length;

  const rfqHref = boq.projectId ? `/procurement/rfqs/new?projectId=${boq.projectId}&boqId=${boq.id}` : null;

  return (
    <>
      <PageHeader
        back={{ href: "/boq", label: "BOQs" }}
        title={<>{boq.name} <span className="align-middle text-base font-normal text-muted">v{boq.version}</span></>}
        description={
          <>
            {ws.facility ? <Link href={`/facilities/${ws.facility.id}`} className="hover:underline">{ws.facility.name}</Link> : "No facility"}
            {" · "}
            {ws.project ? <Link href={`/procurement/${ws.project.id}`} className="hover:underline">{ws.project.code} — {ws.project.title}</Link> : "No project"}
            {" · "}
            <Link href={`/boq/standards/${boq.standardSetId}`} className="hover:underline">{ws.standard?.name}</Link>
            {" · updated "}{formatDate(boq.updatedAt)}
          </>
        }
        actions={
          <>
            <StatusBadge value={boq.status} />
            <a href={`/boq/${boq.id}/export`} className="inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">
              Export to Excel
            </a>
            {can(me.role, "procurement.edit") && (rfqHref
              ? <LinkButton href={rfqHref} variant="primary">Create RFQ from this BOQ</LinkButton>
              : <span title="Link this BOQ to a project on the Departments tab first — an RFQ belongs to a project.">
                  <Button type="button" disabled>Create RFQ from this BOQ</Button>
                </span>)}
          </>
        }
      />
      <Notice notice={sp.notice} error={sp.error} />
      {!rfqHref && can(me.role, "procurement.edit") && (
        <p className="-mt-2 mb-4 text-xs text-muted">
          To raise an RFQ, link this BOQ to a project in <Link href={`/boq/${boq.id}?tab=scope`} className="text-primary hover:underline">BOQ settings</Link>.
        </p>
      )}

      {regenSummary && (
        <div role="status" className="mb-5 rounded-[var(--radius-panel)] border border-ok/30 bg-ok-soft px-4 py-3 text-sm">
          <p className="font-semibold text-ok">Generated from the standard</p>
          <p className="mt-1 whitespace-pre-line text-ink">{regenSummary}</p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Subtotal" value={formatMoney(totals.subtotal, cur, { compact: totals.subtotal >= 1e6 })}
          hint={totals.unpricedLines ? `${totals.unpricedLines} lines have no price` : `${formatNumber(ws.lines.length)} lines · ${formatNumber(units)} units`} />
        <Stat label={`Contingency ${boq.contingencyPct}%`} value={formatMoney(totals.contingency, cur, { compact: totals.contingency >= 1e6 })} />
        <Stat label="Grand total" value={formatMoney(totals.grandTotal, cur, { compact: totals.grandTotal >= 1e6 })} hint={formatMoney(totals.grandTotal, cur)} />
        <Stat label="Departments" value={formatNumber(ws.depts.length)}
          hint={[overrides && `${overrides} overridden`, manual && `${manual} by hand`].filter(Boolean).join(" · ") || `${formatNumber(boq.totalHospitalBeds)} hospital beds`} />
      </div>

      <Panel className="mb-5" padded>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted">Workflow:</span>
          {boq.status === "DRAFT" && mayEdit && <StatusForm boqId={boq.id} action={submitBoqForApproval} label="Submit for approval" primary />}
          {boq.status === "UNDER_REVIEW" && mayEdit && <StatusForm boqId={boq.id} action={withdrawBoqFromReview} label="Back to draft" />}
          {boq.status === "UNDER_REVIEW" && <span className="text-sm text-muted">Waiting for approval — see the approval chain below.</span>}
          {can(me.role, "boq.approve") && boq.status === "UNDER_REVIEW" && <LinkButton href="/approvals" variant="ghost">Open approvals</LinkButton>}
          {boq.status !== "SUPERSEDED" && mayEdit && (
            <form action={createNewVersion}>
              <input type="hidden" name="boqId" value={boq.id} />
              <Button variant="secondary" title={`Copies this BOQ as version ${boq.version + 1} and marks this one superseded`}>Create new version</Button>
            </form>
          )}
          {!locked && (
            <form action={regenerate}>
              <input type="hidden" name="boqId" value={boq.id} /><input type="hidden" name="tab" value={tab} />
              <Button variant="secondary" title="Recalculate from the standard set. Your overrides and hand-added lines are kept.">Regenerate from standard</Button>
            </form>
          )}
          {boq.status === "DRAFT" && mayEdit && (
            <details className="relative ml-auto">
              <summary className="cursor-pointer list-none rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger-soft">Delete draft…</summary>
              <form action={deleteBoq} className="absolute right-0 z-10 mt-1 w-72 space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-sm shadow-lg">
                <input type="hidden" name="boqId" value={boq.id} />
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="confirm" value="yes" required className="mt-0.5 size-4 accent-[var(--color-danger)]" />
                  <span>Delete &ldquo;{boq.name}&rdquo; and all {formatNumber(ws.lines.length)} lines. This can&apos;t be undone.</span>
                </label>
                <Button variant="danger">Delete this draft</Button>
              </form>
            </details>
          )}
        </div>
        {statusLocked && (
          <p className="mt-2 text-sm text-muted">
            {boq.status === "APPROVED" ? "Approved BOQs are locked. Create a new version to make changes."
              : boq.status === "UNDER_REVIEW" ? "Frozen while it waits for approval, so approvers see exactly what was submitted. Take it back to draft to change it."
              : "This version has been superseded by a newer one and is read-only."}
          </p>
        )}
      </Panel>

      {(boq.status === "UNDER_REVIEW" || boq.status === "APPROVED") && (
        <div className="mb-5"><ApprovalPanel entity="BOQ" entityId={boq.id} returnPath={`/boq/${boq.id}`} title="BOQ approval" /></div>
      )}

      <TabLinks active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/boq/${boq.id}?tab=${t.key}` }))} />

      {tab === "department" && <ByDepartmentTab ws={ws} locked={locked} showWhy={sp.why === "1"} devices={await level3DeviceOptions()} />}
      {tab === "device" && <ByDeviceTab ws={ws} />}
      {tab === "scope" && <ScopeData ws={ws} locked={locked} me={me} />}
      {tab === "gap" && <GapTab ws={ws} installed={await installedCounts(ws.depts.map((d) => d.departmentId).filter((x): x is number => !!x))} />}
      {tab === "assumptions" && <AssumptionsTab ws={ws} rules={await rulesForSet(boq.standardSetId)} />}
      {tab === "history" && <History boqId={boq.id} />}
    </>
  );
}

function StatusForm({ boqId, action, label, primary }: { boqId: number; action: (fd: FormData) => Promise<void>; label: string; primary?: boolean }) {
  return (
    <form action={action}>
      <input type="hidden" name="boqId" value={boqId} />
      <Button variant={primary ? "primary" : "secondary"}>{label}</Button>
    </form>
  );
}

async function ScopeData({ ws, locked, me }: { ws: NonNullable<Awaited<ReturnType<typeof getBoqWorkspace>>>; locked: boolean; me: CurrentUser }) {
  const scope = await facilityScope(me);
  const [types, facs, projs, real] = await Promise.all([
    departmentTypeList(),
    db.select({ id: facilities.id, name: facilities.name, code: facilities.code }).from(facilities)
      .where(scope ? inArray(facilities.id, scope.length ? scope : [-1]) : undefined).orderBy(asc(facilities.name)),
    db.select({ id: projects.id, code: projects.code, title: projects.title }).from(projects)
      .where(scopeWhere(projects.facilityId, scope)).orderBy(desc(projects.createdAt)),
    ws.boq.facilityId
      ? db.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments)
        .where(eq(departments.facilityId, ws.boq.facilityId)).orderBy(asc(departments.name))
      : Promise.resolve([]),
  ]);
  return (
    <ScopeTab ws={ws} locked={locked}
      deptTypes={types.map((t) => ({ value: t.code, label: `${t.name} (${t.code})` }))}
      facilities={facs.map((f) => ({ value: f.id, label: `${f.name} (${f.code})` }))}
      projects={projs.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` }))}
      realDepartments={real.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} />
  );
}

async function History({ boqId }: { boqId: number }) {
  const items = await getActivity("boq", boqId, 50);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
    {items.length === 0 ? <p className="text-sm text-muted">No activity recorded yet.</p> : (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3">
          <p className="text-xs text-muted">{formatDate(a.at)} · {a.action.replace(/_/g, " ")}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{a.summary}</p>
        </li>
      ))}
    </ol>
    )}
    <DocumentsPanel entityType="boq" entityId={boqId} returnPath={`/boq/${boqId}?tab=history`} title="Attachments" />
    </div>
  );
}
