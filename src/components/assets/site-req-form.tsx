"use client";
/**
 * Site planning data of a make and model (wave 9, "will it fit"). "Start from typical values" fills the form with rough
 * figures for the modality and marks the source as typical, so nobody mistakes them for the manufacturer's.
 */
import { useState } from "react";
import { ActionForm } from "./action-form";
import { Button, Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { TYPICAL } from "@/lib/assets/site-fit";
import type { FormState } from "@/lib/assets/forms";

export const TYPICAL_SOURCE = "Typical values — replace with the manufacturer's site planning guide";
const NUMS = [
  ["lengthM", "Length (m)"], ["widthM", "Width (m)"], ["heightM", "Height (m)"], ["clearanceM", "Service space all round (m)"],
  ["minRoomLengthM", "Room length at least (m)"], ["minRoomWidthM", "Room width at least (m)"], ["minAreaM2", "Room area at least (m²)"], ["minCeilingM", "Clear ceiling at least (m)"],
  ["doorWidthM", "Door clear width (m)"], ["doorHeightM", "Door clear height (m)"], ["weightKg", "Weight (kg)"], ["powerKva", "Power (kVA)"],
  ["heatKw", "Heat output (kW)"], ["fringeAlongM", "5 gauss line along the bore (m)"], ["fringeAcrossM", "5 gauss line across (m)"],
] as const;
const FLAGS = [["chilledWater", "Chilled water"], ["quenchPipe", "Quench pipe"], ["rfShield", "RF shielded room"], ["leadLined", "Lead (radiation) shielding"]] as const;
type V = Record<string, string | boolean>;

export function SiteReqForm({ modelId, v, action }: {
  modelId: number; v: V | null;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [vals, setVals] = useState<V>(v ?? { clearanceM: "0.6" });
  const set = (k: string, x: string | boolean) => setVals((o) => ({ ...o, [k]: x }));
  const typical = String(vals.source ?? "").toLowerCase().startsWith("typical");
  const fill = (key: string) => {
    const t = TYPICAL[key]; if (!t) return;
    const n: V = { notes: vals.notes ?? "", source: TYPICAL_SOURCE, verified: false };
    for (const [k] of NUMS) { const x = (t.req as Record<string, unknown>)[k]; n[k] = x == null ? "" : String(x); }
    for (const [k] of FLAGS) n[k] = !!(t.req as Record<string, unknown>)[k];
    setVals(n);
  };
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="modelId" value={modelId} />
      <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-sunken p-3 text-sm">
        <Field label="Start from typical values" className="min-w-56">
          <Select aria-label="Typical values" defaultValue="" onChange={(e) => { fill(e.target.value); e.target.value = ""; }}
            placeholder="Choose a modality…" options={Object.entries(TYPICAL).map(([k, t]) => ({ value: k, label: t.label }))} />
        </Field>
        <p className="flex-1 text-xs text-muted">Rough planning figures only. Replace them with the manufacturer&apos;s site planning guide before a room is built.</p>
      </div>
      {typical && <p role="note" className="rounded border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">These are typical values, not this model&apos;s. Replace them with the manufacturer&apos;s site planning guide.</p>}
      <FormGrid cols={3}>
        {NUMS.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input name={k} inputMode="decimal" value={String(vals[k] ?? "")} onChange={(e) => set(k, e.target.value)} required={k === "lengthM" || k === "widthM"} />
          </Field>
        ))}
      </FormGrid>
      <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <legend className="mb-1 text-sm font-semibold">The room needs</legend>
        {FLAGS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name={k} checked={!!vals[k]} onChange={(e) => set(k, e.target.checked)} />{label}</label>
        ))}
      </fieldset>
      <Field label="Source" hint="Guide name, revision and page, e.g. “Site planning guide rev. C, p. 12”.">
        <Input name="source" value={String(vals.source ?? "")} onChange={(e) => set("source", e.target.value)} maxLength={300} />
      </Field>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" name="verified" checked={!typical && !!vals.verified} disabled={typical} onChange={(e) => set("verified", e.target.checked)} />
        Checked against the manufacturer&apos;s guide {typical && <span className="text-muted">(not possible for typical values)</span>}
      </label>
      <Field label="Notes"><Textarea name="notes" rows={2} value={String(vals.notes ?? "")} onChange={(e) => set("notes", e.target.value)} maxLength={2000} /></Field>
      <div className="flex gap-2">
        <Button>Save site data</Button>
        {v && <Button variant="secondary" name="clear" value="1">Remove site data</Button>}
      </div>
    </ActionForm>
  );
}
