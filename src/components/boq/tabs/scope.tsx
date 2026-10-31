import { Button, Field, FormGrid, Input, Panel, Select, Textarea } from "@/components/ui";
import { CURRENCIES, formatNumber } from "@/lib/format";
import type { BoqWorkspace } from "@/lib/boq/queries";
import {
  deleteDepartment, importFacilityDepartments, regenerate, saveDepartment, saveDepartmentAnswers, updateBoqSettings,
} from "@/app/boq/actions";
import { DEPARTMENT_QUESTIONS, FEATURES } from "@/lib/boq/questions";

type Opt = { value: string | number; label: string };

const TIERS = [
  { value: "ESSENTIAL", label: "Essential" }, { value: "RECOMMENDED", label: "Recommended" }, { value: "OPTIONAL", label: "Optional" },
];

export function ScopeTab({ ws, locked, deptTypes, facilities, projects, realDepartments }: {
  ws: BoqWorkspace; locked: boolean; deptTypes: Opt[]; facilities: Opt[]; projects: Opt[]; realDepartments: Opt[];
}) {
  const { boq, depts } = ws;
  const tiers = boq.includeTiers as string[];
  const deptBeds = depts.filter((d) => d.departmentTypeCode !== "HOSP").reduce((s, d) => s + d.beds * d.instances, 0);
  const disabled = locked ? { disabled: true } : {};

  return (
    <div className="space-y-6">
      <Panel title="Departments in scope"
        actions={!locked && (
          <form action={regenerate}>
            <input type="hidden" name="boqId" value={boq.id} /><input type="hidden" name="tab" value="scope" />
            <Button>Regenerate from standard</Button>
          </form>
        )}>
        <p className="mb-3 text-sm text-muted">
          Edits here change the inputs only. Press &ldquo;Regenerate from standard&rdquo; to recalculate the lines — your overrides and hand-added lines are kept.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[14px]">
            <thead className="text-left text-[13px] text-muted">
              <tr>
                <th className="pb-2 pr-2 font-semibold">Department type</th>
                <th className="pb-2 pr-2 font-semibold">Label</th>
                <th className="pb-2 pr-2 font-semibold">Linked facility department</th>
                <th className="w-20 pb-2 pr-2 text-right font-semibold">Beds</th>
                <th className="w-20 pb-2 pr-2 text-right font-semibold">Rooms</th>
                <th className="w-20 pb-2 pr-2 text-right font-semibold">Instances</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {depts.map((d) => {
                const formId = `dept-form-${d.id}`;
                return (
                  <tr key={d.id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2">
                      <form id={formId} action={saveDepartment}>
                        <input type="hidden" name="boqId" value={boq.id} /><input type="hidden" name="deptId" value={d.id} />
                      </form>
                      <Select form={formId} name="departmentTypeCode" aria-label="Department type" defaultValue={d.departmentTypeCode} options={deptTypes} {...disabled} />
                    </td>
                    <td className="py-1.5 pr-2"><Input form={formId} name="label" aria-label="Label" defaultValue={d.label} required {...disabled} /></td>
                    <td className="py-1.5 pr-2">
                      <Select form={formId} name="departmentId" aria-label="Linked facility department" defaultValue={d.departmentId ?? ""}
                        placeholder={realDepartments.length ? "Not linked" : "No facility departments"} options={realDepartments} {...disabled} />
                    </td>
                    <td className="py-1.5 pr-2"><Input form={formId} name="beds" aria-label="Beds" type="number" min={0} className="text-right" defaultValue={d.beds} {...disabled} /></td>
                    <td className="py-1.5 pr-2"><Input form={formId} name="rooms" aria-label="Rooms" type="number" min={0} className="text-right" defaultValue={d.rooms} {...disabled} /></td>
                    <td className="py-1.5 pr-2"><Input form={formId} name="instances" aria-label="Instances" type="number" min={1} className="text-right" defaultValue={d.instances} {...disabled} /></td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      {!locked && (
                        <>
                          <Button form={formId} variant="secondary">Save</Button>
                          <form action={deleteDepartment} className="ml-1 inline">
                            <input type="hidden" name="boqId" value={boq.id} /><input type="hidden" name="deptId" value={d.id} />
                            <Button variant="danger" aria-label={`Remove ${d.label}`} title="Removes the department and its lines">Remove</Button>
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!locked && (
                <tr className="border-t border-line align-top">
                  <td className="py-2 pr-2">
                    <form id="dept-form-new" action={saveDepartment}><input type="hidden" name="boqId" value={boq.id} /></form>
                    <Select form="dept-form-new" name="departmentTypeCode" aria-label="New department type" options={deptTypes} />
                  </td>
                  <td className="py-2 pr-2"><Input form="dept-form-new" name="label" aria-label="New department label" placeholder="e.g. Surgical ICU" required /></td>
                  <td className="py-2 pr-2">
                    <Select form="dept-form-new" name="departmentId" aria-label="Linked facility department" placeholder="Not linked" options={realDepartments} />
                  </td>
                  <td className="py-2 pr-2"><Input form="dept-form-new" name="beds" aria-label="Beds" type="number" min={0} className="text-right" defaultValue={0} /></td>
                  <td className="py-2 pr-2"><Input form="dept-form-new" name="rooms" aria-label="Rooms" type="number" min={0} className="text-right" defaultValue={0} /></td>
                  <td className="py-2 pr-2"><Input form="dept-form-new" name="instances" aria-label="Instances" type="number" min={1} className="text-right" defaultValue={1} /></td>
                  <td className="py-2 text-right"><Button form="dept-form-new">Add department</Button></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Department beds total {formatNumber(deptBeds)}. Link a department to a real facility department to compare plan and installed assets.</p>

        {!locked && facilities.length > 0 && (
          <form action={importFacilityDepartments} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <input type="hidden" name="boqId" value={boq.id} />
            <Field label="Import departments from a facility" className="min-w-64">
              <Select name="facilityId" defaultValue={boq.facilityId ?? ""} options={facilities} placeholder="Pick a facility" />
            </Field>
            <Button variant="secondary">Import departments</Button>
            <span className="text-xs text-muted">Skips departments already linked. Rooms exclude corridors, stores, offices, waiting and nurse stations.</span>
          </form>
        )}
      </Panel>

      {depts.some((d) => DEPARTMENT_QUESTIONS[d.departmentTypeCode]) && (
        <Panel title="Planning questions">
          <p className="mb-3 text-sm text-muted">Throughput sizes the big items more accurately than beds alone (e.g. one CT per 15,000 exams a year). Leave blank to use the bed and room ratios. Regenerate after saving.</p>
          <div className="space-y-4">
            {depts.filter((d) => DEPARTMENT_QUESTIONS[d.departmentTypeCode]).map((d) => (
              <form key={d.id} action={saveDepartmentAnswers} className="rounded-[var(--radius-control)] border border-line p-3">
                <input type="hidden" name="boqId" value={boq.id} /><input type="hidden" name="deptId" value={d.id} />
                <p className="mb-2 text-sm font-semibold">{d.label}</p>
                <div className="flex flex-wrap items-end gap-3">
                  {DEPARTMENT_QUESTIONS[d.departmentTypeCode].map((q) => (
                    <Field key={q.key} label={q.label} hint={q.hint} className="w-56">
                      <Input name={`param_${q.key}`} type="number" min={0} step={1} defaultValue={d.params?.[q.key] ?? ""} placeholder="Not answered" {...disabled} />
                    </Field>
                  ))}
                  {!locked && <Button variant="secondary">Save answers</Button>}
                </div>
              </form>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="BOQ settings">
        <form action={updateBoqSettings}>
          <input type="hidden" name="boqId" value={boq.id} />
          <FormGrid cols={3}>
            <Field label="Name" className="sm:col-span-2 lg:col-span-3"><Input name="name" defaultValue={boq.name} required {...disabled} /></Field>
            <Field label="Total hospital beds" hint={`0 uses the department beds (${deptBeds}).`}>
              <Input name="totalHospitalBeds" type="number" min={0} defaultValue={boq.totalHospitalBeds} {...disabled} />
            </Field>
            <Field label="Currency" hint="Changing it converts every unit price at today's stored rate.">
              <Select name="currency" defaultValue={boq.currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} {...disabled} />
            </Field>
            <Field label="Contingency %"><Input name="contingencyPct" type="number" min={0} max={100} step="0.5" defaultValue={boq.contingencyPct} {...disabled} /></Field>
            <Field label="Facility"><Select name="facilityId" defaultValue={boq.facilityId ?? ""} placeholder="No facility" options={facilities} {...disabled} /></Field>
            <Field label="Project / tender"><Select name="projectId" defaultValue={boq.projectId ?? ""} placeholder="No project" options={projects} {...disabled} /></Field>
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">Tiers to include</legend>
              <div className="flex flex-wrap gap-3">
                {TIERS.map((t) => (
                  <label key={t.value} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="includeTiers" value={t.value} defaultChecked={tiers.includes(t.value)} className="accent-[var(--color-primary)]" {...disabled} />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Target budget" hint={`Optional, in ${boq.currency}. Shown against the total.`}>
              <Input name="targetBudget" type="number" min={0} step="1000" defaultValue={boq.targetBudget ?? ""} {...disabled} />
            </Field>
            <fieldset className="sm:col-span-2 lg:col-span-3">
              <legend className="mb-1 text-sm font-semibold">Hospital features</legend>
              <p className="mb-2 text-xs text-muted">Each switches on extra rules in the standard (marked with the feature in the line explanation). Regenerate after changing.</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FEATURES.map((f) => (
                  <label key={f.key} className="flex items-start gap-1.5 text-sm">
                    <input type="checkbox" name="features" value={f.key} defaultChecked={(boq.features ?? []).includes(f.key)} className="mt-1 accent-[var(--color-primary)]" {...disabled} />
                    <span>{f.label}<span className="block text-xs text-muted">{f.hint}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" defaultValue={boq.notes ?? ""} {...disabled} /></Field>
          </FormGrid>
          {!locked && <div className="mt-4"><Button>Save settings</Button></div>}
        </form>
      </Panel>
    </div>
  );
}
