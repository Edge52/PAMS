import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { boqs, offers, projects, rfqs, rfqSuppliers, suppliers } from "@/db/schema";
import { Badge, Details, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, StatusBadge, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { ActivityPanel, DaysLeft } from "@/components/procurement/bits";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { offerTotals, rfqLines, splitRfqNotes } from "@/lib/procurement/server";
import { inviteSuppliers, setRfqStatus, updateInvitation, updateRfqNotes } from "../actions";

import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ rfq: rfqs, project: projects, boq: { id: boqs.id, name: boqs.name } }).from(rfqs)
    .innerJoin(projects, eq(projects.id, rfqs.projectId)).leftJoin(boqs, eq(boqs.id, rfqs.boqId)).where(eq(rfqs.id, id));
  if (!row) notFound();
  const { rfq, project } = row;
  await requireFacilityAccess(project.facilityId, me);
  const mayEdit = can(me.role, "procurement.edit");
  const mayOffer = can(me.role, "offers.edit");
  const boq = row.boq?.id ? row.boq : null;
  const { text: notes, scope } = splitRfqNotes(rfq.notes);

  const [lines, invited, responses, allSuppliers] = await Promise.all([
    rfqLines(rfq),
    db.select({ inv: rfqSuppliers, name: suppliers.name, email: suppliers.email, phone: suppliers.phone, contact: suppliers.contactName })
      .from(rfqSuppliers).innerJoin(suppliers, eq(suppliers.id, rfqSuppliers.supplierId)).where(eq(rfqSuppliers.rfqId, id)).orderBy(asc(suppliers.name)),
    db.select({ id: offers.id, reference: offers.reference, status: offers.status, currency: offers.currency, offerDate: offers.offerDate, supplierId: offers.supplierId, supplier: suppliers.name })
      .from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.rfqId, id)).orderBy(asc(offers.id)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
  ]);
  const totals = await offerTotals(responses.map((r) => r.id));
  const invitedIds = new Set(invited.map((i) => i.inv.supplierId));
  const notInvited = allSuppliers.filter((s) => !invitedIds.has(s.id));
  const open = rfq.status === "DRAFT" || rfq.status === "ISSUED";

  const statusButtons: { to: string; label: string; variant: "primary" | "secondary" | "danger" }[] =
    rfq.status === "DRAFT" ? [{ to: "ISSUED", label: "Issue RFQ", variant: "primary" }, { to: "CANCELLED", label: "Cancel RFQ", variant: "danger" }]
      : rfq.status === "ISSUED" ? [{ to: "CLOSED", label: "Close and start evaluation", variant: "primary" }, { to: "CANCELLED", label: "Cancel RFQ", variant: "danger" }]
        : rfq.status === "CLOSED" ? [{ to: "ISSUED", label: "Reopen", variant: "secondary" }]
          : [{ to: "DRAFT", label: "Restore as draft", variant: "secondary" }];

  return (
    <>
      <PageHeader
        back={{ href: `/procurement/${project.id}?tab=rfqs`, label: `${project.code} RFQs` }}
        title={<span className="flex flex-wrap items-center gap-2">{rfq.number} <StatusBadge value={rfq.status} /></span>}
        description={rfq.title}
        actions={<>
          {mayEdit && statusButtons.map((b) => (
            <ActionForm key={b.to} action={setRfqStatus} confirm={b.to === "CANCELLED" ? "Cancel this RFQ?" : undefined}>
              <input type="hidden" name="rfqId" value={id} /><input type="hidden" name="status" value={b.to} />
              <SubmitButton variant={b.variant}>{b.label}</SubmitButton>
            </ActionForm>
          ))}
          {mayOffer && <LinkButton href={`/procurement/offers/new?projectId=${project.id}&rfqId=${id}`}>Register offer</LinkButton>}
        </>}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel title="Summary">
            <Details items={[
              { label: "Project", value: <Link href={`/procurement/${project.id}`} className="text-primary hover:underline">{project.code} — {project.title}</Link> },
              { label: "Items from", value: boq ? <Link href={`/boq/${boq.id}`} className="text-primary hover:underline">BOQ: {boq.name}</Link> : "Project specifications" },
              { label: "Issue date", value: rfq.issueDate ? formatDate(rfq.issueDate) : null },
              { label: "Closing date", value: rfq.closingDate ? <DaysLeft date={rfq.closingDate} closedLabel={open ? undefined : "closed"} /> : null },
              { label: "Suppliers invited", value: `${invited.length} (${invited.filter((i) => i.inv.responded).length} responded)` },
              { label: "Offers received", value: responses.length },
            ]} />
            {notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-sm">{notes}</p>}
          </Panel>

          <Panel title={<span className="flex items-center gap-2">Lines <Badge>{lines.length}</Badge></span>} padded={false}>
            {lines.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                {boq ? "The linked BOQ has no lines in this RFQ's scope." : <>No items: the project has no specifications. <Link href={`/procurement/${project.id}?tab=specs`} className="text-primary hover:underline">Add specifications</Link>.</>}
              </p>
            ) : (
              <Table className="rounded-none border-0">
                <THead><tr><Th>#</Th><Th>Device type</Th><Th align="right">Quantity</Th><Th>Departments</Th><Th>Specification</Th></tr></THead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.deviceTypeId}>
                      <Td className="text-muted">{i + 1}</Td>
                      <Td><span className="font-semibold">{l.name}</span><span className="block text-xs text-muted">{l.code}</span></Td>
                      <Td align="right">{l.quantity != null ? formatNumber(l.quantity) : <span className="text-xs text-muted">per offer</span>}</Td>
                      <Td className="text-xs text-muted">{l.departments.join(", ") || "—"}</Td>
                      <Td>{l.specId ? <Link href={`/procurement/specs/${l.specId}/print`} className="text-sm text-primary hover:underline">Spec sheet ({l.specItemCount})</Link>
                        : <span className="text-xs text-warn">No specification</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {scope && <p className="border-t border-line px-4 py-2 text-xs text-muted">Scope limited to {scope.length} of the source items.</p>}
          </Panel>

          <Panel title="Responses" padded={false}>
            {responses.length === 0 ? (
              <div className="p-4"><EmptyState title="No offers registered against this RFQ"
                action={mayOffer ? <LinkButton href={`/procurement/offers/new?projectId=${project.id}&rfqId=${id}`} variant="primary">Register offer</LinkButton> : undefined}>
                When a quotation arrives, register it here with its lines and prices.</EmptyState></div>
            ) : (
              <Table className="rounded-none border-0">
                <THead><tr><Th>Supplier</Th><Th>Reference</Th><Th>Date</Th><Th>Status</Th><Th align="right">Value</Th></tr></THead>
                <tbody>
                  {responses.map((o) => (
                    <tr key={o.id}>
                      <Td>{o.supplier}</Td>
                      <Td><Link href={`/procurement/offers/${o.id}`} className="font-semibold text-primary hover:underline">{o.reference}</Link></Td>
                      <Td className="whitespace-nowrap">{formatDate(o.offerDate)}</Td>
                      <Td><StatusBadge value={o.status} /></Td>
                      <Td align="right">{formatMoney(totals.get(o.id) ?? 0, o.currency)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <DocumentsPanel entityType="rfq" entityId={id} returnPath={`/procurement/rfqs/${id}`} title="RFQ documents (letter, booklet, clarifications)" />
        </div>

        <div className="space-y-5">
          <Panel title="Invited suppliers" padded={false}>
            {invited.length === 0 ? <p className="p-4 text-sm text-muted">Nobody invited yet. Tick suppliers below.</p> : (
              <ul className="divide-y divide-line">
                {invited.map((i) => {
                  const offer = responses.find((r) => r.supplierId === i.inv.supplierId);
                  return (
                    <li key={i.inv.id} className="px-4 py-2.5 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/procurement/suppliers/${i.inv.supplierId}`} className="font-semibold hover:text-primary">{i.name}</Link>
                        {i.inv.responded || offer ? <Badge tone="ok">Responded</Badge> : <Badge>Awaiting</Badge>}
                      </div>
                      <p className="text-xs text-muted">{[i.contact, i.email, i.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
                      <p className="text-xs text-muted">{i.inv.invitedAt ? `Invited ${formatDate(i.inv.invitedAt)}` : "Not sent yet (draft)"}</p>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs">
                        {offer ? <Link href={`/procurement/offers/${offer.id}`} className="text-primary hover:underline">Offer {offer.reference}</Link> : mayOffer && (
                          <Link href={`/procurement/offers/new?projectId=${project.id}&rfqId=${id}&supplierId=${i.inv.supplierId}`} className="text-primary hover:underline">Register their offer</Link>
                        )}
                        {mayEdit && <ActionForm action={updateInvitation}>
                          <input type="hidden" name="invitationId" value={i.inv.id} />
                          <input type="hidden" name="op" value={i.inv.responded ? "not_responded" : "responded"} />
                          <button className="text-primary hover:underline">{i.inv.responded ? "Mark not responded" : "Mark responded"}</button>
                        </ActionForm>}
                        {!offer && mayEdit && (
                          <ActionForm action={updateInvitation}>
                            <input type="hidden" name="invitationId" value={i.inv.id} /><input type="hidden" name="op" value="remove" />
                            <button className="text-danger hover:underline">Remove</button>
                          </ActionForm>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {notInvited.length > 0 && rfq.status !== "CANCELLED" && mayEdit && (
              <ActionForm action={inviteSuppliers} className="border-t border-line p-4">
                <input type="hidden" name="rfqId" value={id} />
                <p className="mb-2 text-sm font-semibold">Invite more suppliers</p>
                <ul className="mb-3 max-h-56 space-y-1 overflow-y-auto">
                  {notInvited.map((s) => (
                    <li key={s.id}><label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="supplierIds" value={s.id} className="size-4 accent-[var(--color-primary)]" />{s.name}</label></li>
                  ))}
                </ul>
                <SubmitButton variant="secondary">Invite selected</SubmitButton>
              </ActionForm>
            )}
          </Panel>

          {mayEdit && <Panel title="Edit details">
            <ActionForm action={updateRfqNotes} className="space-y-3">
              <input type="hidden" name="rfqId" value={id} />
              <FormGrid cols={1}>
                <Field label="Title"><Input name="title" defaultValue={rfq.title} required /></Field>
                <Field label="Closing date"><Input type="date" name="closingDate" defaultValue={rfq.closingDate ?? ""} /></Field>
                <Field label="Instructions to suppliers"><Textarea name="notes" defaultValue={notes} /></Field>
              </FormGrid>
              <SubmitButton variant="secondary">Save details</SubmitButton>
            </ActionForm>
          </Panel>}
          <ActivityPanel entityType="rfq" entityId={id} />
        </div>
      </div>
    </>
  );
}
