import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { boqs, projects, techSpecs } from "@/db/schema";
import { Badge, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Select, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { tenderedLines, tenderHint } from "@/lib/boq/tender-handoff";
import { boqRfqLines, handoffLines } from "@/lib/boq/tender-server";
import { addDaysISO, formatNumber, todayISO } from "@/lib/format";
import { scopeWhere } from "@/lib/procurement/access";
import { startTenderFromBoq } from "../../tender-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Start a tender" };

export default async function StartTenderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("boq.view");
  const me = await requirePermission("procurement.edit");
  const boqId = Number((await params).id);
  if (!Number.isInteger(boqId) || boqId <= 0) notFound();
  const [boq] = await db.select().from(boqs).where(eq(boqs.id, boqId));
  if (!boq) notFound();
  await requireFacilityAccess(boq.facilityId, me);
  const scope = await facilityScope(me);
  const [lines, tenderRows, projectList] = await Promise.all([
    handoffLines(boq.id),
    boqRfqLines(boq.id),
    db.select({ id: projects.id, code: projects.code, title: projects.title, facilityId: projects.facilityId }).from(projects)
      .where(and(scopeWhere(projects.facilityId, scope), boq.facilityId ? or(eq(projects.facilityId, boq.facilityId), isNull(projects.facilityId)) : undefined,
        inArray(projects.status, ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION"])))
      .orderBy(desc(projects.id)).limit(200),
  ]);
  const linked = boq.projectId ? (await db.select({ id: projects.id, code: projects.code, title: projects.title, facilityId: projects.facilityId }).from(projects).where(eq(projects.id, boq.projectId)))[0] ?? null : null;
  if (linked && !projectList.some((p) => p.id === linked.id)) projectList.unshift(linked);
  const specTypes = linked ? new Set((await db.select({ t: techSpecs.deviceTypeId }).from(techSpecs).where(eq(techSpecs.projectId, linked.id))).map((r) => r.t)) : new Set<number>();
  const tendered = tenderedLines(tenderRows);
  const groups = [...new Map(lines.map((l) => [l.deviceTypeId, { id: l.deviceTypeId, code: l.deviceCode, name: l.deviceName, lines: lines.filter((x) => x.deviceTypeId === l.deviceTypeId) }])).values()];
  const canSpecs = can(me.role, "specs.edit");
  const year = todayISO().slice(0, 4);

  return (
    <>
      <PageHeader back={{ href: `/boq/${boq.id}`, label: boq.name }} title="Start a tender from this BOQ"
        description={tenderHint({ project: linked, status: boq.status })} />
      {lines.length === 0 ? (
        <EmptyState title="This BOQ has no lines yet" action={<LinkButton href={`/boq/${boq.id}`} variant="primary">Open the BOQ</LinkButton>}>
          Generate the BOQ from its standard or add lines by hand first.
        </EmptyState>
      ) : (
        <ActionForm action={startTenderFromBoq} className="space-y-5">
          <input type="hidden" name="boqId" value={boq.id} />
          <Panel title={<span className="flex items-center gap-2">Lines to tender <Badge>{lines.length}</Badge></span>} padded={false}>
            <p className="px-4 pt-3 text-sm text-muted">Tick lines, or tick a device type to take all its lines. Lines already in an RFQ are not ticked. Each device type becomes one RFQ item.</p>
            <Table className="rounded-none border-0">
              <THead><tr><Th><span className="sr-only">Include</span></Th><Th>Device type / department</Th><Th align="right">Quantity</Th><Th>Already in</Th><Th>Specification</Th></tr></THead>
              <tbody>
                {groups.map((g) => {
                  const qty = g.lines.reduce((s, l) => s + l.quantity, 0);
                  const allFree = g.lines.every((l) => !tendered.has(l.id));
                  return [
                    <tr key={`g${g.id}`} className="bg-sunken">
                      <Td><input type="checkbox" name="group" value={g.id} defaultChecked={allFree && qty > 0} disabled={qty === 0} aria-label={`All lines of ${g.name}`} className="mt-0.5 size-4 accent-[var(--color-primary)]" /></Td>
                      <Td><span className="font-semibold">{g.name}</span> <span className="text-xs text-muted">{g.code} · all {g.lines.length} line{g.lines.length === 1 ? "" : "s"}</span></Td>
                      <Td align="right" className="font-semibold">{formatNumber(qty)}</Td>
                      <Td />
                      <Td>{specTypes.has(g.id) ? <span className="text-sm text-ok">In the project</span> : <span className="text-xs text-muted">{canSpecs ? "Draft from the template (option below)" : "None yet"}</span>}</Td>
                    </tr>,
                    ...g.lines.map((l) => (
                      <tr key={l.id}>
                        <Td className="pl-8"><input type="checkbox" name="line" value={l.id} disabled={l.quantity === 0} aria-label={`${g.name}, ${l.department ?? "whole hospital"}`} className="mt-0.5 size-4 accent-[var(--color-primary)]" /></Td>
                        <Td className="pl-8 text-sm">{l.department ?? "Whole hospital"}<span className="block text-xs text-muted">{l.explanation ?? l.tier.toLowerCase()}</span></Td>
                        <Td align="right">{formatNumber(l.quantity)}</Td>
                        <Td className="text-xs">{tendered.get(l.id)?.join(", ") ?? "—"}</Td>
                        <Td />
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </Table>
          </Panel>

          <Panel title="Project">
            <fieldset className="space-y-3">
              <legend className="sr-only">Project for the RFQ</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="projectMode" value="existing" defaultChecked={!!linked || projectList.length > 0} disabled={!projectList.length} className="accent-[var(--color-primary)]" />
                An existing project
              </label>
              {projectList.length > 0 && (
                <Field label="Project" className="max-w-xl">
                  <Select name="projectId" defaultValue={linked?.id ?? ""} placeholder="Choose a project" options={projectList.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` }))} />
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="projectMode" value="new" defaultChecked={!linked && projectList.length === 0} className="accent-[var(--color-primary)]" />
                A new project{boq.projectId ? "" : " (this BOQ is linked to it)"}
              </label>
              <FormGrid cols={2}>
                <Field label="Tender or project code" hint="Used when the new project option is chosen"><Input name="code" placeholder={`T-${year}-…`} /></Field>
                <Field label="Project title"><Input name="title" defaultValue={`Equipment for ${boq.name}`} /></Field>
              </FormGrid>
            </fieldset>
          </Panel>

          <Panel title="RFQ">
            <FormGrid cols={2}>
              <Field label="RFQ title"><Input name="rfqTitle" required defaultValue={`Request for quotation — ${boq.name}`} /></Field>
              <Field label="Closing date" hint="Last day to submit offers"><Input type="date" name="closingDate" defaultValue={addDaysISO(todayISO(), 21)} /></Field>
            </FormGrid>
            {canSpecs && (
              <label className="mt-4 flex items-start gap-2 text-sm">
                <input type="checkbox" name="makeSpecs" defaultChecked className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                <span>Start a draft specification for each item the project has none for (from the device type template).</span>
              </label>
            )}
            <p className="mt-3 text-sm text-muted">The RFQ is saved as a draft: invite suppliers and issue it from the RFQ page. Quantities are copied now, so later BOQ changes don&apos;t move them.</p>
          </Panel>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton>Create the draft RFQ</SubmitButton>
            <Link href={`/boq/${boq.id}?tab=orders`} className="text-sm text-primary hover:underline">See plan vs ordered</Link>
          </div>
        </ActionForm>
      )}
    </>
  );
}
