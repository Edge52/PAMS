import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, offers, projects, suppliers, users } from "@/db/schema";
import { Badge, Field, FormGrid, Input, Panel, Select, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { AwardTimeline } from "@/components/procurement/award-timeline";
import { can, ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/format";
import { CAPACITIES, CAPACITY_LABELS, COMMITTEE_KINDS, KIND_LABELS, requiredCommittees, type Capacity, type CommitteeKind } from "@/lib/procurement/committees";
import { tenderCompliance } from "@/lib/procurement/tender";
import { addCommitteeMember, createCommittee, deleteCommittee, removeCommitteeMember, updateCommittee } from "../../committees/actions";

type Project = typeof projects.$inferSelect;
const egp = (n: number) => formatMoney(n, "EGP");

export async function CommitteesTab({ project, me }: { project: Project; me: CurrentUser }) {
  const mayEdit = can(me.role, "procurement.edit");
  const { settings, estimate, committees, warnings } = await tenderCompliance(project);
  const req = requiredCommittees(estimate.valueEgp, settings);
  const people = await db.select({ id: users.id, name: users.name, role: users.role, jobTitle: users.jobTitle }).from(users)
    .where(eq(users.active, true)).orderBy(asc(users.name));
  const kinds = new Set(committees.map((c) => c.kind));
  const available = COMMITTEE_KINDS.filter((k) => !kinds.has(k) && (k === "COMBINED" ? kinds.size === 0 : !kinds.has("COMBINED")));

  const projectOffers = await db.select({ offer: offers, supplier: suppliers.name }).from(offers)
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.projectId, project.id)).orderBy(asc(offers.id));
  const awardRequests = projectOffers.length
    ? await db.select().from(approvalRequests)
      .where(and(eq(approvalRequests.entity, "AWARD"), inArray(approvalRequests.entityId, projectOffers.map((o) => o.offer.id))))
      .orderBy(desc(approvalRequests.id))
    : [];
  const approved = projectOffers.filter((o) => o.offer.status === "AWARDED" && o.offer.awardApprovedOn);

  return (
    <div className="space-y-5">
      <Panel title="What this tender needs (Law 182/2018)">
        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Estimated value</p>
            <p className="text-lg font-bold">{estimate.valueEgp != null ? egp(estimate.valueEgp) : "Unknown"}</p>
            <p className="text-xs text-muted">From the {estimate.source}{estimate.amount != null && estimate.currency !== "EGP" ? ` (${formatMoney(estimate.amount, estimate.currency ?? "USD")})` : ""}{estimate.amount != null && estimate.valueEgp == null ? " — no exchange rate to EGP" : ""}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Committees</p>
            <p className="font-semibold">{estimate.valueEgp == null ? "Opening + adjudication (value unknown)" : req.combinedAllowed ? "One combined committee is allowed" : "Envelope opening + adjudication"}</p>
            <p className="text-xs text-muted">Combined only up to {egp(settings.singleCommitteeMaxEgp)} (art. 28)</p>
          </div>
          <div>
            <p className="text-xs text-muted">Representatives required (art. 29)</p>
            <ul className="space-y-0.5">
              <li>Ministry of Finance: <strong>{req.mofRep ? "required" : "not required"}</strong> <span className="text-xs text-muted">above {egp(settings.mofRepFromEgp)}</span></li>
              <li>State Council (Fatwa Dept.): <strong>{req.stateCouncil ? "required" : "not required"}</strong> <span className="text-xs text-muted">above {egp(settings.stateCouncilFromEgp)}</span></li>
            </ul>
          </div>
        </div>
      </Panel>

      {warnings.length > 0 ? (
        <section aria-label="Compliance checks" className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} role={w.level === "error" ? "alert" : "status"} className={`rounded-[var(--radius-panel)] border px-4 py-2.5 text-sm ${w.level === "error" ? "border-danger bg-danger-soft text-danger" : "border-warn bg-warn-soft text-warn"}`}>
              <span className="font-semibold">{w.level === "error" ? "Must fix" : "Check"} · {w.article}: </span>{w.text}
            </div>
          ))}
          {warnings.some((w) => w.level === "error") && <p className="text-xs text-muted">An award can&apos;t be recommended while a “must fix” item applies to the adjudication committee.</p>}
        </section>
      ) : (
        <div role="status" className="rounded-[var(--radius-panel)] border border-ok bg-ok-soft px-4 py-2.5 text-sm text-ok">The committees meet the checks this system makes. Keep the formation decisions and minutes in the tender documents.</div>
      )}

      {committees.map((c) => {
        const voting = c.members.filter((m) => m.votes).length;
        return (
          <Panel key={c.id} title={<span className="flex flex-wrap items-center gap-2">{KIND_LABELS[c.kind as CommitteeKind]} <Badge>{c.members.length} member{c.members.length === 1 ? "" : "s"}, {voting} voting</Badge></span>}
            actions={mayEdit ? (
              <ActionForm action={deleteCommittee} confirm={`Delete the ${KIND_LABELS[c.kind as CommitteeKind].toLowerCase()} and its member list?`}>
                <input type="hidden" name="committeeId" value={c.id} /><SubmitButton variant="danger" className="px-2 py-1 text-xs">Delete</SubmitButton>
              </ActionForm>
            ) : undefined}>
            <p className="mb-3 text-sm text-muted">
              Formation decision {c.decisionRef ? <strong className="text-ink">{c.decisionRef}</strong> : "not recorded"}
              {c.formedOn && <> · formed {formatDate(c.formedOn)}</>}{c.dueBy && <> · report due {formatDate(c.dueBy)}</>}
            </p>
            {c.notes && <p className="mb-3 whitespace-pre-line text-sm">{c.notes}</p>}
            {c.members.length === 0 ? <p className="mb-3 text-sm text-muted">No members yet. Add the people named in the formation decision.</p> : (
              <Table className="mb-4">
                <THead><tr><Th>Member</Th><Th>Capacity</Th><Th>Signs</Th>{mayEdit && <Th />}</tr></THead>
                <tbody>
                  {c.members.map((m) => (
                    <tr key={m.id}>
                      <Td>{m.name}<span className="block text-xs text-muted">{m.userId ? `${m.userEmail} · ${ROLE_LABELS[m.userRole as Role] ?? m.userRole}` : "External — no account, signs on paper"}</span></Td>
                      <Td>{CAPACITY_LABELS[m.capacity as Capacity]}</Td>
                      <Td>{m.votes ? (m.userId ? "In the app" : "On paper") : <span className="text-muted">Doesn&apos;t vote</span>}</Td>
                      {mayEdit && <Td align="right">
                        <ActionForm action={removeCommitteeMember} confirm={`Remove ${m.name} from the committee?`}>
                          <input type="hidden" name="memberId" value={m.id} /><SubmitButton variant="ghost" className="px-2 py-1 text-xs">Remove</SubmitButton>
                        </ActionForm>
                      </Td>}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {mayEdit && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ActionForm action={addCommitteeMember} className="space-y-3 rounded-[var(--radius-control)] border border-line p-3">
                  <p className="text-sm font-semibold">Add a member</p>
                  <input type="hidden" name="committeeId" value={c.id} />
                  <Field label="User account" hint="Members with an account sign the award recommendation in the app.">
                    <Select name="userId" placeholder="External member (no account)" options={people.map((u) => ({ value: u.id, label: `${u.name} — ${u.jobTitle ?? ROLE_LABELS[u.role as Role]}` }))} />
                  </Field>
                  <Field label="Or the external member's name" hint="E.g. the Ministry of Finance representative. A procurement officer records their signature from the signed minutes.">
                    <Input name="name" placeholder="Name and organisation" />
                  </Field>
                  <Field label="Capacity">
                    <Select name="capacity" defaultValue="MEMBER" options={CAPACITIES.map((k) => ({ value: k, label: CAPACITY_LABELS[k] }))} />
                  </Field>
                  <SubmitButton variant="secondary">Add member</SubmitButton>
                </ActionForm>
                <ActionForm action={updateCommittee} className="space-y-3 rounded-[var(--radius-control)] border border-line p-3">
                  <p className="text-sm font-semibold">Formation decision</p>
                  <input type="hidden" name="committeeId" value={c.id} />
                  <Field label="Decision number"><Input name="decisionRef" defaultValue={c.decisionRef ?? ""} /></Field>
                  <FormGrid cols={2}>
                    <Field label="Formed on"><Input type="date" name="formedOn" defaultValue={c.formedOn ?? ""} /></Field>
                    <Field label="Report due by"><Input type="date" name="dueBy" defaultValue={c.dueBy ?? ""} /></Field>
                  </FormGrid>
                  <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={c.notes ?? ""} /></Field>
                  <SubmitButton variant="secondary">Save details</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Panel>
        );
      })}

      {mayEdit && available.length > 0 && (
        <Panel title="Form a committee">
          <ActionForm action={createCommittee} className="space-y-4">
            <input type="hidden" name="projectId" value={project.id} />
            <FormGrid cols={4}>
              <Field label="Committee">
                <Select name="kind" defaultValue={available.includes("ADJUDICATION") && !req.combinedAllowed ? (kinds.has("OPENING") ? "ADJUDICATION" : "OPENING") : available[0]}
                  options={available.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
              </Field>
              <Field label="Formation decision no." hint="The competent authority's decision"><Input name="decisionRef" /></Field>
              <Field label="Formed on"><Input type="date" name="formedOn" /></Field>
              <Field label="Report due by"><Input type="date" name="dueBy" /></Field>
            </FormGrid>
            <SubmitButton>Create committee</SubmitButton>
          </ActionForm>
        </Panel>
      )}

      {(awardRequests.length > 0 || approved.length > 0) && (
        <section aria-labelledby="awards-h" className="space-y-3">
          <h2 id="awards-h" className="text-lg font-bold">Award recommendations</h2>
          {awardRequests.length > 0 && (
            <Table>
              <THead><tr><Th>Recommendation</Th><Th>Submitted</Th><Th>Status</Th></tr></THead>
              <tbody>
                {awardRequests.map((r) => (
                  <tr key={r.id}>
                    <Td><Link href={r.href} className="font-semibold text-primary hover:underline">{r.title}</Link></Td>
                    <Td className="whitespace-nowrap">{formatDate(r.requestedAt)}</Td>
                    <Td><Badge tone={r.status === "APPROVED" ? "ok" : r.status === "PENDING" ? "warn" : r.status === "REJECTED" ? "danger" : "neutral"}>
                      {{ PENDING: "Waiting for signatures", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Withdrawn" }[r.status]}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {approved.map((o) => <AwardTimeline key={o.offer.id} offer={o.offer} supplier={o.supplier} canRecord={can(me.role, "award.recommend")} linkOffer />)}
        </section>
      )}

      <Panel title="About these checks">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li><strong className="text-ink">Art. 28:</strong> committees are formed by decision of the competent authority and include technical, financial and legal members. Each tender has an envelope-opening and an adjudication committee, or one combined committee up to {egp(settings.singleCommitteeMaxEgp)}. Nobody may chair a committee and also be the authority who approves its work.</li>
          <li><strong className="text-ink">Art. 29:</strong> a Ministry of Finance representative sits on the committees above {egp(settings.mofRepFromEgp)}, and a State Council (Fatwa Department) member above {egp(settings.stateCouncilFromEgp)}. Meetings are invalid without the required representatives.</li>
          <li><strong className="text-ink">Art. 23:</strong> bids come in two envelopes, technical and financial; financial envelopes are opened only for technically accepted bids.</li>
          <li><strong className="text-ink">Art. 35:</strong> the committee submits its minutes and recommendation to the competent authority, who approves the award. Here: “Recommend award” on the offer → every voting member signs → the competent authority approves.</li>
          <li><strong className="text-ink">Art. 39:</strong> after approval all bidders are notified; there are {settings.complaintDays} days for complaints, then the winner is notified of acceptance within {settings.acceptanceNoticeDays} days.</li>
          <li>These are checks to help prepare the tender file, not legal advice. Thresholds and periods are set by an administrator under Approval rules &amp; settings.</li>
        </ul>
      </Panel>
    </div>
  );
}
