"use client";
import { useActionState, useState, useTransition } from "react";
import { Button, Field, FormGrid, Input, Panel, Select } from "@/components/ui";
import type { PresetRow } from "@/lib/boq/presets";
import { keepInputs } from "@/lib/submit-keep";

type Opt = { value: string | number; label: string };
type Row = PresetRow & { key: number; departmentId: number | null };
type FormState = { error?: string; ok?: string } | undefined;

export interface CreateFormProps {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  loadFacility: (facilityId: number) => Promise<{ rows: (PresetRow & { departmentId: number | null })[]; totalBeds: number }>;
  standardSets: (Opt & { isDefault: boolean; ruleCount: number })[];
  facilities: Opt[];
  projects: (Opt & { facilityId: number | null })[];
  departmentTypes: Opt[];
  presets: { key: string; name: string; description: string; totalBeds: number; rows: PresetRow[] }[];
  currencies: readonly string[];
  initialFacilityId?: number | null;
  initialProjectId?: number | null;
}

let keySeq = 1;
const withKeys = (rows: (PresetRow & { departmentId?: number | null })[]): Row[] =>
  rows.map((r) => ({ ...r, departmentId: r.departmentId ?? null, key: keySeq++ }));

const TIER_OPTIONS = [
  { value: "ESSENTIAL", label: "Essential", hint: "Minimum to open the department" },
  { value: "RECOMMENDED", label: "Recommended", hint: "Normal good practice" },
  { value: "OPTIONAL", label: "Optional", hint: "Nice to have" },
];

export function BoqCreateForm(p: CreateFormProps) {
  const [state, formAction, pending] = useActionState(p.action, undefined);
  const defaultSet = p.standardSets.find((s) => s.isDefault) ?? p.standardSets[0];
  const [rows, setRows] = useState<Row[]>([]);
  const [facilityId, setFacilityId] = useState<string>(p.initialFacilityId ? String(p.initialFacilityId) : "");
  const [projectId, setProjectId] = useState<string>(p.initialProjectId ? String(p.initialProjectId) : "");
  const [beds, setBeds] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [importing, startImport] = useTransition();

  const sumBeds = rows.reduce((s, r) => s + (r.beds || 0) * (r.instances || 1), 0);

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function applyPreset(key: string) {
    const preset = p.presets.find((x) => x.key === key);
    if (!preset) return;
    setRows(withKeys(preset.rows));
    if (preset.totalBeds) setBeds(String(preset.totalBeds));
    setMessage(`Loaded "${preset.name}" — ${preset.rows.length} departments. Adjust beds and rooms to your project.`);
  }
  function importFacility() {
    const id = Number(facilityId);
    if (!id) { setMessage("Pick a facility first, then import its departments."); return; }
    startImport(async () => {
      const res = await p.loadFacility(id);
      if (res.rows.length === 0) { setMessage("That facility has no departments yet. Add them on the facility page, or enter them here."); return; }
      setRows(withKeys(res.rows));
      if (res.totalBeds) setBeds(String(res.totalBeds));
      setMessage(`Imported ${res.rows.length} departments. Rooms count clinical rooms only (corridors, stores, offices, waiting and nurse stations are left out).`);
    });
  }
  function onProjectChange(v: string) {
    setProjectId(v);
    const proj = p.projects.find((x) => String(x.value) === v);
    if (proj?.facilityId && !facilityId) setFacilityId(String(proj.facilityId));
  }

  return (
    <form onSubmit={keepInputs(formAction, { busy: pending })} className="space-y-6">
      <Panel title="1 · About this BOQ">
        <FormGrid cols={3}>
          <Field label="Name" className="sm:col-span-2 lg:col-span-3">
            <Input name="name" required placeholder="e.g. New Cairo General Hospital — equipment BOQ" />
          </Field>
          <Field label="Standard set" hint={defaultSet ? "Rules and ratios the quantities come from." : undefined}>
            <Select name="standardSetId" defaultValue={defaultSet?.value}
              options={p.standardSets.map((s) => ({ value: s.value, label: `${s.label}${s.isDefault ? " (default)" : ""} · ${s.ruleCount} rules` }))} />
          </Field>
          <Field label="Facility" hint="Optional. Needed to import departments or compare with installed assets.">
            <Select name="facilityId" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} placeholder="No facility" options={p.facilities} />
          </Field>
          <Field label="Project / tender" hint="Optional. Needed to raise an RFQ from this BOQ.">
            <Select name="projectId" value={projectId} onChange={(e) => onProjectChange(e.target.value)} placeholder="No project" options={p.projects} />
          </Field>
          <Field label="Total hospital beds" hint={`Used by "per hospital beds" rules. Leave 0 to use the department beds (${sumBeds}).`}>
            <Input name="totalHospitalBeds" type="number" min={0} inputMode="numeric" value={beds} onChange={(e) => setBeds(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Currency" hint="Device price bands are in USD and are converted with the stored exchange rate.">
            <Select name="currency" defaultValue="USD" options={p.currencies.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Contingency %">
            <Input name="contingencyPct" type="number" min={0} max={100} step="0.5" defaultValue={5} inputMode="decimal" />
          </Field>
        </FormGrid>
        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-semibold">Tiers to include</legend>
          <div className="flex flex-wrap gap-4">
            {TIER_OPTIONS.map((t) => (
              <label key={t.value} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="includeTiers" value={t.value} defaultChecked={t.value !== "OPTIONAL"} className="mt-1 accent-[var(--color-primary)]" />
                <span><span className="font-semibold">{t.label}</span><span className="block text-xs text-muted">{t.hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      </Panel>

      <Panel
        title="2 · Departments in scope"
        actions={<span className="text-sm text-muted">{rows.length} departments · {sumBeds} beds</span>}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={importFacility} disabled={importing}>
            {importing ? "Importing…" : "Import from facility"}
          </Button>
          <span className="text-sm text-muted">or start from a preset:</span>
          {p.presets.map((pr) => (
            <Button key={pr.key} type="button" variant="ghost" title={pr.description} onClick={() => applyPreset(pr.key)}>{pr.name}</Button>
          ))}
        </div>
        {message && <p className="mb-3 rounded-[var(--radius-control)] bg-info-soft px-3 py-2 text-sm text-info" role="status">{message}</p>}

        {rows.length === 0 ? (
          <p className="rounded-[var(--radius-control)] border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            No departments yet. Import them from a facility, load a preset, or add them one by one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead className="text-left text-[13px] text-muted">
                <tr>
                  <th className="pb-2 pr-2 font-semibold">Department type</th>
                  <th className="pb-2 pr-2 font-semibold">Label</th>
                  <th className="w-24 pb-2 pr-2 text-right font-semibold">Beds</th>
                  <th className="w-24 pb-2 pr-2 text-right font-semibold">Rooms</th>
                  <th className="w-24 pb-2 pr-2 text-right font-semibold" title="Identical copies of this department">Instances</th>
                  <th className="w-10 pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      <Select name="dept_type" aria-label="Department type" value={r.departmentTypeCode} options={p.departmentTypes}
                        onChange={(e) => update(r.key, { departmentTypeCode: e.target.value })} />
                      <input type="hidden" name="dept_department_id" value={r.departmentId ?? ""} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input name="dept_label" aria-label="Label" value={r.label} required onChange={(e) => update(r.key, { label: e.target.value })} />
                    </td>
                    <td className="py-1.5 pr-2"><Input name="dept_beds" aria-label="Beds" type="number" min={0} className="text-right" value={r.beds}
                      onChange={(e) => update(r.key, { beds: Number(e.target.value) || 0 })} /></td>
                    <td className="py-1.5 pr-2"><Input name="dept_rooms" aria-label="Rooms" type="number" min={0} className="text-right" value={r.rooms}
                      onChange={(e) => update(r.key, { rooms: Number(e.target.value) || 0 })} /></td>
                    <td className="py-1.5 pr-2"><Input name="dept_instances" aria-label="Instances" type="number" min={1} className="text-right" value={r.instances}
                      onChange={(e) => update(r.key, { instances: Number(e.target.value) || 1 })} /></td>
                    <td className="py-1.5 text-right">
                      <button type="button" className="rounded px-2 py-1 text-danger hover:bg-danger-soft" aria-label={`Remove ${r.label}`}
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3">
          <Button type="button" variant="secondary"
            onClick={() => setRows((rs) => [...rs, ...withKeys([{ departmentTypeCode: String(p.departmentTypes[0]?.value ?? ""), label: "", beds: 0, rooms: 0, instances: 1 }])])}>
            Add department
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Beds feed &ldquo;per bed&rdquo; rules, rooms feed &ldquo;per room&rdquo; rules (theatres, imaging rooms, clinics). Instances multiply the whole department.
          Hospital-wide items (mobile X-ray, AEDs…) are added to a &ldquo;Hospital-wide&rdquo; department automatically.
        </p>
      </Panel>

      {state?.error && <p className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || rows.length === 0 || !defaultSet}>{pending ? "Generating…" : "Generate BOQ"}</Button>
        {rows.length === 0 && <span className="text-sm text-muted">Add at least one department to generate.</span>}
      </div>
    </form>
  );
}
