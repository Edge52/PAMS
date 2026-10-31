import { asc } from "drizzle-orm";
import { db } from "@/db";
import { approvalPolicies, facilities } from "@/db/schema";
import { Badge, Field, FormGrid, Input, PageHeader, Panel, Select, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatMoney, num } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { saveSettings, savePolicy, togglePolicy } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval rules & settings" };

const ENTITY_LABEL: Record<string, string> = { PO: "Purchase orders", BOQ: "BOQs", AWARD: "Award recommendations" };
const ENTITY_LOWER: Record<string, string> = { PO: "purchase orders", BOQ: "BOQs", AWARD: "award recommendations" };
const ENTITY_HELP: Record<string, string> = {
  PO: "Every rule whose amount range contains the order's value (converted to EGP when submitted) becomes a step. Steps run in order; rules with the same order are decided in parallel.",
  BOQ: "Steps a BOQ goes through after the planner submits it. Amounts don't apply.",
  AWARD: "After every voting member of the adjudication committee signs, these steps follow. The last one is the competent authority (Law 182/2018 art. 35). The committee chair can never decide them (art. 28).",
};
const roleOptions = ROLES.filter((r) => r !== "VIEWER").map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  const [policies, facs, s] = await Promise.all([
    db.select().from(approvalPolicies).orderBy(asc(approvalPolicies.entity), asc(approvalPolicies.stepOrder), asc(approvalPolicies.minAmountEgp), asc(approvalPolicies.id)),
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).orderBy(asc(facilities.name)),
    getSettings(),
  ]);
  const facName = new Map(facs.map((f) => [f.id, f.name]));
  const facOptions = facs.map((f) => ({ value: f.id, label: f.name }));

  return (
    <>
      <PageHeader title="Approval rules & settings"
        description="Who approves purchase orders, BOQs and awards, the Law 182/2018 thresholds the tender checks use, and system switches. Changes apply to requests submitted from now on; requests already in progress keep their steps." />

      <div className="space-y-6">
        {(["PO", "BOQ", "AWARD"] as const).map((entity) => {
          const rows = policies.filter((p) => p.entity === entity);
          return (
            <Panel key={entity} title={ENTITY_LABEL[entity]} padded={false}>
              <p className="border-b border-line px-4 py-3 text-sm text-muted">{ENTITY_HELP[entity]}</p>
              {rows.length === 0 ? <p className="px-4 py-3 text-sm text-warn">No rules: these are approved automatically when submitted. Add a rule below.</p> : (
                <Table className="rounded-none border-0">
                  <THead><tr><Th>Step</Th><Th>Name</Th><Th>Approver role</Th>{entity === "PO" && <Th>Applies to (EGP)</Th>}<Th>Facility</Th><Th>Status</Th><Th /></tr></THead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className={p.active ? undefined : "text-muted"}>
                        <Td>{p.stepOrder}</Td>
                        <Td className="font-semibold">{p.label}</Td>
                        <Td>{ROLE_LABELS[p.approverRole as Role]}</Td>
                        {entity === "PO" && <Td className="whitespace-nowrap">{num(p.minAmountEgp) === 0 && p.maxAmountEgp == null ? "Every order" : `${formatMoney(p.minAmountEgp, "EGP")}${p.maxAmountEgp != null ? ` to below ${formatMoney(p.maxAmountEgp, "EGP")}` : " and above"}`}</Td>}
                        <Td>{p.facilityId ? facName.get(p.facilityId) ?? "—" : "All facilities"}</Td>
                        <Td>{p.active ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}</Td>
                        <Td className="whitespace-nowrap">
                          <details className="relative inline-block">
                            <summary className="cursor-pointer list-none text-sm font-semibold text-primary hover:underline">Edit</summary>
                            <div className="absolute right-0 z-10 mt-1 w-[min(36rem,90vw)] rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-lg">
                              <PolicyForm entity={entity} policy={p} facOptions={facOptions} />
                            </div>
                          </details>
                          <ActionForm action={togglePolicy} className="ml-3 inline-block">
                            <input type="hidden" name="id" value={p.id} />
                            <SubmitButton variant="ghost" className="px-2 py-0.5 text-xs">{p.active ? "Switch off" : "Switch on"}</SubmitButton>
                          </ActionForm>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <details className="border-t border-line px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-primary">Add a rule for {ENTITY_LOWER[entity]}</summary>
                <div className="mt-3"><PolicyForm entity={entity} facOptions={facOptions} /></div>
              </details>
            </Panel>
          );
        })}

        <Panel title="Settings">
          <ActionForm action={saveSettings} className="space-y-6">
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-bold">Tender committees (Law 182/2018)</legend>
              <FormGrid cols={3}>
                <Field label="Award recommendation quorum" hint="All: every voting member must sign. Majority: more than half; the recommendation fails once a majority is out of reach. Secretaries never vote.">
                  <Select name="committeeQuorum" defaultValue={s.committeeQuorum} options={[{ value: "all", label: "All voting members" }, { value: "majority", label: "Majority of voting members" }]} />
                </Field>
                <Field label="One combined committee up to (EGP)" hint="Art. 28: up to this estimated value the opening and adjudication committees may be one committee.">
                  <Input type="number" min={0} step="1" name="singleCommitteeMaxEgp" defaultValue={s.singleCommitteeMaxEgp} />
                </Field>
                <Field label="Ministry of Finance representative above (EGP)" hint="Art. 29: required on the committees when the estimated value is more than this.">
                  <Input type="number" min={0} step="1" name="mofRepFromEgp" defaultValue={s.mofRepFromEgp} />
                </Field>
                <Field label="State Council member above (EGP)" hint="Art. 29: a member of the State Council's Fatwa Department when the value is more than this.">
                  <Input type="number" min={0} step="1" name="stateCouncilFromEgp" defaultValue={s.stateCouncilFromEgp} />
                </Field>
                <Field label="Complaint period (days)" hint="Art. 39: days bidders have to complain after being notified of the award.">
                  <Input type="number" min={0} max={60} name="complaintDays" defaultValue={s.complaintDays} />
                </Field>
                <Field label="Acceptance notice due (days after)" hint="Art. 39: days after the complaint period to notify the winner of acceptance.">
                  <Input type="number" min={0} max={60} name="acceptanceNoticeDays" defaultValue={s.acceptanceNoticeDays} />
                </Field>
              </FormGrid>
              <p className="text-xs text-muted">Defaults follow the law&apos;s English translation (EGP 300,000; 1,000,000; 2,000,000; 7 and 2 days). Change them only if the law or your regulations change.</p>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-bold">Alerts</legend>
              <FormGrid cols={3}>
                <Field label="Warn before an offer expires (days)" hint="Open offers whose validity ends within this many days are flagged.">
                  <Input type="number" min={0} max={365} name="offerExpiryWarnDays" defaultValue={s.offerExpiryWarnDays} />
                </Field>
                <Field label="Warn before a warranty ends (days)" hint="Assets whose warranty ends within this many days are flagged.">
                  <Input type="number" min={0} max={730} name="warrantyWarnDays" defaultValue={s.warrantyWarnDays} />
                </Field>
                <Field label="Warn before an RFQ closes (days)" hint="Issued RFQs closing within this many days are flagged.">
                  <Input type="number" min={0} max={90} name="rfqClosingWarnDays" defaultValue={s.rfqClosingWarnDays} />
                </Field>
              </FormGrid>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-bold">System</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="emailEnabled" defaultChecked={s.emailEnabled} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                <span><span className="font-semibold">Send notification emails</span><span className="block text-xs text-muted">Needs SMTP_URL and MAIL_FROM set on the server. Notifications always appear in the app.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="demoAccounts" defaultChecked={s.demoAccounts} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                <span><span className="font-semibold">Show demo accounts on the sign-in page</span><span className="block text-xs text-muted">For demonstrations only. Switch off for real use — and remove or change the demo accounts&apos; passwords.</span></span>
              </label>
            </fieldset>
            <SubmitButton>Save settings</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}

function PolicyForm({ entity, policy, facOptions }: {
  entity: "PO" | "BOQ" | "AWARD"; policy?: typeof approvalPolicies.$inferSelect; facOptions: { value: number; label: string }[];
}) {
  return (
    <ActionForm action={savePolicy} className="space-y-3">
      {policy && <input type="hidden" name="id" value={policy.id} />}
      <input type="hidden" name="entity" value={entity} />
      <FormGrid cols={2}>
        <Field label="Step name" hint="Shown to approvers, e.g. “Finance”."><Input name="label" defaultValue={policy?.label ?? ""} required /></Field>
        <Field label="Approver role" hint="Anyone holding this role (and able to see the facility) can decide the step — except the person who submitted it.">
          <Select name="approverRole" defaultValue={policy?.approverRole ?? (entity === "PO" ? "FINANCE" : "DIRECTOR")} options={roleOptions} />
        </Field>
        {entity === "PO" && <>
          <Field label="From amount (EGP)" hint="The step applies when the order is worth at least this."><Input type="number" min={0} step="0.01" name="minAmountEgp" defaultValue={policy ? num(policy.minAmountEgp) : 0} /></Field>
          <Field label="Below amount (EGP)" hint="Leave empty for no upper limit."><Input type="number" min={0} step="0.01" name="maxAmountEgp" defaultValue={policy?.maxAmountEgp != null ? num(policy.maxAmountEgp) : ""} /></Field>
        </>}
        <Field label="Step order" hint="1 runs first. Same number = decided in parallel."><Input type="number" min={1} max={99} name="stepOrder" defaultValue={policy?.stepOrder ?? 1} /></Field>
        <Field label="Facility" hint="Limit the rule to one facility, or leave it for all.">
          <Select name="facilityId" defaultValue={policy?.facilityId ?? ""} placeholder="All facilities" options={facOptions} />
        </Field>
      </FormGrid>
      <SubmitButton variant="secondary">{policy ? "Save rule" : "Add rule"}</SubmitButton>
    </ActionForm>
  );
}
