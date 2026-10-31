import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { boqs, deviceTypes, projects, suppliers } from "@/db/schema";
import { Badge, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Select, StatusBadge, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { addDaysISO, formatMoney, formatNumber, todayISO } from "@/lib/format";
import { boqGroups, projectBoqs, projectSpecs } from "@/lib/procurement/server";
import { createRfq } from "../actions";

import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "New RFQ" };

export default async function NewRfqPage({ searchParams }: { searchParams: Promise<{ projectId?: string; boqId?: string }> }) {
  await requirePermission("procurement.view");
  const me = await requirePermission("procurement.edit");
  const sp = await searchParams;
  const projectId = Number(sp.projectId);
  const boqId = sp.boqId ? Number(sp.boqId) : null;

  // Step 1: choose a project (e.g. when arriving from a BOQ that is not linked to a project yet).
  if (!Number.isInteger(projectId) || projectId <= 0) {
    const list = await db.select({ id: projects.id, code: projects.code, title: projects.title }).from(projects)
      .where(scopeWhere(projects.facilityId, await facilityScope(me))).orderBy(desc(projects.id));
    return (
      <>
        <PageHeader title="New request for quotation" back={{ href: "/procurement", label: "Projects & tenders" }}
          description="An RFQ belongs to a project. Choose the project this request is for." />
        {list.length === 0 ? (
          <EmptyState title="Create a project first" action={<LinkButton href="/procurement/new" variant="primary">New project</LinkButton>}>
            RFQs, offers and purchase orders are organised by project or tender.
          </EmptyState>
        ) : (
          <Panel>
            <form className="flex flex-wrap items-end gap-3">
              {boqId && <input type="hidden" name="boqId" value={boqId} />}
              <Field label="Project" className="min-w-72 flex-1">
                <Select name="projectId" required placeholder="Choose a project" options={list.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` }))} />
              </Field>
              <button className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong">Continue</button>
            </form>
          </Panel>
        )}
      </>
    );
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return (
      <>
        <PageHeader title="New request for quotation" back={{ href: "/procurement", label: "Projects & tenders" }} />
        <EmptyState title="That project was not found" action={<LinkButton href="/procurement/rfqs/new">Choose another project</LinkButton>}>
          It may have been deleted. Pick the project again.
        </EmptyState>
      </>
    );
  }
  await requireFacilityAccess(project.facilityId, me);

  const [boqList, specs, supplierRows] = await Promise.all([
    projectBoqs(project),
    projectSpecs(projectId),
    db.select({ id: suppliers.id, name: suppliers.name, brands: suppliers.brands, type: suppliers.type }).from(suppliers)
      .where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
  ]);
  let boq: { id: number; name: string; status: string; version: number } | null = null;
  if (boqId && Number.isInteger(boqId)) {
    const [b] = await db.select({ id: boqs.id, name: boqs.name, status: boqs.status, version: boqs.version }).from(boqs).where(eq(boqs.id, boqId));
    boq = b ?? null;
  }
  const groups = boq ? await boqGroups(boq.id) : [];
  const specTypes = !boq && specs.size
    ? await db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes)
      .where(inArray(deviceTypes.id, [...specs.keys()])).orderBy(asc(deviceTypes.code))
    : [];
  const boqOptions = [...boqList];
  if (boq && !boqOptions.some((b) => b.id === boq!.id)) boqOptions.unshift({ ...boq, status: boq.status as (typeof boqList)[number]["status"], projectId: null });
  const items = boq
    ? groups.map((g) => ({ id: g.deviceTypeId, code: g.code, name: g.name, qty: g.quantity, est: g.estimate, depts: [...new Set(g.lines.map((l) => l.department).filter(Boolean))] as string[] }))
    : specTypes.map((t) => ({ id: t.id, code: t.code, name: t.name, qty: null as number | null, est: null as number | null, depts: [] as string[] }));

  return (
    <>
      <PageHeader title="New request for quotation" back={{ href: `/procurement/${projectId}?tab=rfqs`, label: project.code }}
        description={<>For <Link href={`/procurement/${projectId}`} className="text-primary hover:underline">{project.title}</Link>. Choose what to quote for and who to invite.</>} />

      <Panel title="Source of the item list" className="mb-5">
        <form className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="BOQ" className="min-w-72 flex-1" hint={boqOptions.length ? "Quantities come from the BOQ, grouped by device type" : "No BOQ for this project's facility yet — items come from the specifications"}>
            <Select name="boqId" defaultValue={boq?.id ?? ""} placeholder="No BOQ — use the project's specifications"
              options={boqOptions.map((b) => ({ value: b.id, label: `${b.name} (v${b.version}, ${b.status.toLowerCase().replace("_", " ")})` }))} />
          </Field>
          <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Load items</button>
          {boq && <Link href={`/boq/${boq.id}`} className="pb-2 text-sm text-primary hover:underline">Open BOQ</Link>}
        </form>
        {boq && boq.status !== "APPROVED" && (
          <p role="note" className="mt-3 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-sm text-warn">
            This BOQ is {boq.status === "SUPERSEDED" ? "superseded by a newer version" : `still ${boq.status.toLowerCase().replace("_", " ")}`}. Quantities are copied into the RFQ when you create it, so later BOQ changes won&apos;t reach suppliers. Approve the BOQ first if this RFQ is going out.
          </p>
        )}
      </Panel>

      {items.length === 0 ? (
        <EmptyState title={boq ? "This BOQ has no lines with a quantity" : "Nothing to quote for yet"}
          action={<LinkButton href={`/procurement/${projectId}?tab=specs`} variant="primary">Add specifications</LinkButton>}>
          {boq ? "Generate or edit the BOQ first, or choose another source above." : "Add a specification for each device type in this tender, or choose a BOQ above to take the items and quantities from it."}
        </EmptyState>
      ) : (
        <ActionForm action={createRfq} className="space-y-5">
          <input type="hidden" name="projectId" value={projectId} />
          {boq && <input type="hidden" name="boqId" value={boq.id} />}
          <input type="hidden" name="scopeTotal" value={items.length} />

          <Panel title={<span className="flex items-center gap-2">Items to quote <Badge>{items.length}</Badge></span>} padded={false}>
            <Table className="rounded-none border-0">
              <THead><tr>
                <Th><span className="sr-only">Include</span></Th><Th>Device type</Th>
                {boq && <Th align="right">Quantity</Th>}{boq && <Th>Departments</Th>}{boq && <Th align="right">Estimate</Th>}
                <Th>Specification</Th>
              </tr></THead>
              <tbody>
                {items.map((i) => {
                  const spec = specs.get(i.id);
                  return (
                    <tr key={i.id}>
                      <Td><input type="checkbox" name="scope" value={i.id} defaultChecked aria-label={`Include ${i.name}`} className="mt-0.5 size-4 accent-[var(--color-primary)]" /></Td>
                      <Td><span className="font-semibold">{i.name}</span><span className="block text-xs text-muted">{i.code}</span></Td>
                      {boq && <Td align="right" className="font-semibold">{formatNumber(i.qty)}</Td>}
                      {boq && <Td className="text-xs text-muted">{i.depts.join(", ") || "—"}</Td>}
                      {boq && <Td align="right">{i.est ? formatMoney(i.est, project.currency) : "—"}</Td>}
                      <Td>{spec
                        ? <Link href={`/procurement/specs/${spec.id}`} className="text-sm text-primary hover:underline">{spec.items.length} parameters</Link>
                        : <span className="text-xs text-warn">No specification yet</span>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Panel>

          <Panel title="Details">
            <FormGrid cols={3}>
              <Field label="Title" className="sm:col-span-2 lg:col-span-3">
                <Input name="title" required defaultValue={`Request for quotation — ${project.title}`} />
              </Field>
              <Field label="Issue date"><Input type="date" name="issueDate" defaultValue={todayISO()} /></Field>
              <Field label="Closing date" hint="Last day to submit offers"><Input type="date" name="closingDate" defaultValue={project.submissionDeadline && project.submissionDeadline > todayISO() ? project.submissionDeadline : addDaysISO(todayISO(), 21)} /></Field>
            </FormGrid>
            <Field label="Instructions to suppliers" className="mt-4">
              <Textarea name="notes" rows={3} placeholder="Delivery terms, required documents (CE/FDA, EDA registration, compliance statement), validity of at least 90 days…" />
            </Field>
          </Panel>

          <Panel title="Invite suppliers">
            {supplierRows.length === 0 ? (
              <p className="text-sm text-muted">No suppliers yet. <Link href="/procurement/suppliers/new" className="text-primary hover:underline">Add a supplier</Link>, or save the RFQ as a draft and invite them later.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {supplierRows.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 hover:bg-sunken">
                      <input type="checkbox" name="supplierIds" value={s.id} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                      <span className="min-w-0 text-sm"><span className="font-semibold">{s.name}</span>
                        <span className="block truncate text-xs text-muted">{s.brands?.join(", ") || <StatusBadge value={s.type} />}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="flex flex-wrap gap-2">
            <SubmitButton name="intent" value="issue">Issue RFQ</SubmitButton>
            <SubmitButton name="intent" value="draft" variant="secondary">Save as draft</SubmitButton>
          </div>
        </ActionForm>
      )}
    </>
  );
}
