"use client";
/**
 * BOQ quick start: a few questions → a complete, priced BOQ. The answers live here; defaults come from the hospital
 * templates (lib/boq/templates); the review step runs the real engine on the server (previewQuickStartAction) and
 * "Create BOQ" saves it (createQuickStartAction). Every quantity in the result still explains itself.
 */
import { useState, useTransition } from "react";
import { Badge, Button, Field, Input, Panel, Select } from "@/components/ui";
import { createQuickStartAction, previewQuickStartAction, type Preview } from "@/app/boq/quick-start/actions";
import { FEATURES } from "@/lib/boq/questions";
import { PRICE_TIER_HELP, PRICE_TIER_LABELS, PRICE_TIERS } from "@/lib/boq/pricing";
import { bedSplit, buildScope, defaultAnswers, HOSPITAL_TYPES, TEMPLATES, type QuickStartAnswers, type Services } from "@/lib/boq/templates";
import { formatMoney, formatNumber } from "@/lib/format";

const STEPS = ["Hospital", "Beds", "Services", "Special conditions", "Budget", "Building", "Review"] as const;

export function QuickStartWizard({ facilities, currencies }: { facilities: { value: number; label: string }[]; currencies: readonly string[] }) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<QuickStartAnswers>(() => defaultAnswers("general"));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scope = buildScope(a);

  const set = (patch: Partial<QuickStartAnswers>) => { setA((x) => ({ ...x, ...patch })); setPreview(null); };
  const svc = (patch: Partial<Services>) => set({ services: { ...a.services, ...patch } });
  // Type, ownership or total beds re-applies the template's defaults for beds, services, features and tier.
  const retemplate = (patch: Partial<Pick<QuickStartAnswers, "type" | "ownership" | "totalBeds">>) => {
    const next = { type: a.type, ownership: a.ownership, totalBeds: a.totalBeds, ...patch };
    const d = defaultAnswers(next.type, next.ownership, next.totalBeds);
    setA((x) => ({ ...d, name: x.name, currency: x.currency, facilityId: x.facilityId, targetBudget: x.targetBudget }));
    setPreview(null);
  };
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  function go(to: number) {
    setError(null);
    if (to > 1 && scope.problems.length) { setStep(1); setError(scope.problems[0]); return; }
    if (to > 0 && a.name.trim().length < 2) { setStep(0); setError("Give the BOQ a name."); return; }
    setStep(to);
    if (STEPS[to] === "Review") start(async () => { const p = await previewQuickStartAction(a); setPreview(p); if (p.error) setError(p.error); });
  }
  function create() {
    setError(null);
    start(async () => { const r = await createQuickStartAction(a); if (r?.error) setError(r.error); });
  }

  const money = (v: number | undefined) => (v == null ? "—" : formatMoney(v, a.currency, { compact: v >= 1e6 }));
  const nf = (label: string, value: number, onChange: (v: number) => void, hint?: string, max = 5000) => (
    <Field key={label} label={label} hint={hint}><Input type="number" min={0} max={max} inputMode="numeric" value={value} onChange={(e) => onChange(num(e.target.value))} /></Field>
  );
  const check = (label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label key={label} className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-[var(--color-primary)]" />
      <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="Quick start steps" className="min-w-0">
        <ol className="flex gap-1 overflow-x-auto lg:flex-col">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined}
                className={`w-full whitespace-nowrap rounded-[var(--radius-control)] px-3 py-1.5 text-left text-sm ${i === step ? "bg-primary-soft font-semibold text-primary-strong" : i < step ? "text-ink hover:bg-sunken" : "text-muted hover:bg-sunken"}`}>
                <span className="mr-2 text-xs text-muted">{i + 1}</span>{s}
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-3 hidden text-xs text-muted lg:block">{scope.departments.length} departments so far · {formatNumber(a.totalBeds)} beds</p>
      </nav>

      <Panel title={STEPS[step]} className="min-w-0">
        {error && <p role="alert" className="mb-4 rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        {step === 0 && (
          <div className="space-y-5">
            <Field label="BOQ name"><Input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. New Capital General Hospital — equipment" maxLength={200} /></Field>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Type of hospital</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {HOSPITAL_TYPES.map((t) => (
                  <label key={t} className={`cursor-pointer rounded-[var(--radius-control)] border p-3 text-sm ${a.type === t ? "border-primary bg-primary-soft" : "border-line hover:border-primary"}`}>
                    <input type="radio" name="type" value={t} checked={a.type === t} onChange={() => retemplate({ type: t, totalBeds: TEMPLATES[t].beds })} className="sr-only" />
                    <span className="font-semibold">{TEMPLATES[t].label}</span>
                    <span className="block text-xs text-muted">{TEMPLATES[t].description} Template: {TEMPLATES[t].beds} beds.</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ownership" hint="Sets the default price tier: government standard, private premium.">
                <Select value={a.ownership} onChange={(e) => retemplate({ ownership: e.target.value as QuickStartAnswers["ownership"] })}
                  options={[{ value: "government", label: "Government" }, { value: "private", label: "Private" }]} />
              </Field>
              {nf("Total beds", a.totalBeds, (v) => retemplate({ totalBeds: v }), "Changing it re-applies the template's defaults to the next steps.")}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted">Defaults are the template&apos;s share of {formatNumber(a.totalBeds)} beds. The rest become medical, surgical, paediatric and maternity ward beds.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {nf("Total beds", a.totalBeds, (v) => set({ totalBeds: v }))}
              {nf("Adult ICU beds", a.icuBeds, (v) => set({ icuBeds: v }))}
              {nf("Coronary care beds", a.ccuBeds, (v) => set({ ccuBeds: v }))}
              {nf("Neonatal ICU cots", a.nicuBeds, (v) => set({ nicuBeds: v }))}
              {nf("Isolation beds", a.isolationBeds, (v) => set({ isolationBeds: v }))}
            </div>
            <Button type="button" variant="ghost" onClick={() => set(bedSplit(a.type, a.totalBeds))}>Reset to the template&apos;s shares</Button>
            {scope.problems.map((p) => <p key={p} role="alert" className="text-sm text-danger">{p}</p>)}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3">
              {check("Emergency department", a.services.emergency, (v) => svc({ emergency: v }))}
              {check("Cardiac catheterisation lab", a.services.cathLab, (v) => svc({ cathLab: v }))}
              {check("CT", a.services.ct, (v) => svc({ ct: v }), "Sized from about 55 exams a year per bed.")}
              {check("MRI", a.services.mri, (v) => svc({ mri: v }), "About 20 exams a year per bed.")}
              {check("Mammography", a.services.mammography, (v) => svc({ mammography: v }))}
              {check("Laboratory", a.services.laboratory, (v) => svc({ laboratory: v }))}
              {check("Endoscopy", a.services.endoscopy, (v) => svc({ endoscopy: v }))}
              {check("Pharmacy", a.services.pharmacy, (v) => svc({ pharmacy: v }))}
              {check("Sterile services (CSSD)", a.services.sterileServices, (v) => svc({ sterileServices: v }))}
              {check("Physiotherapy", a.services.physiotherapy, (v) => svc({ physiotherapy: v }))}
            </div>
            <div className="space-y-3">
              {nf("Operating theatres", a.services.theatres, (v) => svc({ theatres: v }), "Recovery bays follow at 1.5 per theatre.", 100)}
              {nf("Dialysis chairs", a.services.dialysisChairs, (v) => svc({ dialysisChairs: v }), "0 = no dialysis unit.", 500)}
              {nf("Deliveries a year", a.services.deliveriesPerYear, (v) => svc({ deliveriesPerYear: v }), "0 = no maternity. About 400 a year per delivery room.", 100000)}
              {nf("Outpatient clinic rooms", a.services.clinics, (v) => svc({ clinics: v }), undefined, 500)}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => check(f.label, a.features.includes(f.key), (v) => set({ features: v ? [...a.features, f.key] : a.features.filter((x) => x !== f.key) }), f.hint))}
            <p className="text-xs text-muted sm:col-span-2">Each adds the extra equipment its standard calls for; the BOQ line says which condition added it.</p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Price tier</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {PRICE_TIERS.map((t) => (
                  <label key={t} className={`cursor-pointer rounded-[var(--radius-control)] border p-3 text-sm ${a.priceTier === t ? "border-primary bg-primary-soft" : "border-line hover:border-primary"}`}>
                    <input type="radio" name="priceTier" value={t} checked={a.priceTier === t} onChange={() => set({ priceTier: t })} className="sr-only" />
                    <span className="font-semibold">{PRICE_TIER_LABELS[t]}</span><span className="block text-xs text-muted">{PRICE_TIER_HELP[t]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency"><Select value={a.currency} onChange={(e) => set({ currency: e.target.value })} options={currencies.map((c) => ({ value: c, label: c }))} /></Field>
              <Field label="Target budget (optional)" hint="The review shows how far the plan is from it.">
                <Input type="number" min={0} step={100000} value={a.targetBudget ?? ""} onChange={(e) => set({ targetBudget: e.target.value ? num(e.target.value) : null })} />
              </Field>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <Field label="Link to a facility (optional)" hint="Links the BOQ to a hospital in the system, e.g. one imported from CAD, so plan and installed equipment can be compared later.">
              <Select value={a.facilityId ?? ""} onChange={(e) => set({ facilityId: e.target.value ? Number(e.target.value) : null })} placeholder="No facility" options={facilities} />
            </Field>
            <p className="text-xs text-muted">Counting beds and rooms from the CAD drawings, and opening in phases, come in a later release.</p>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-5" aria-live="polite" aria-busy={pending}>
            {pending && !preview && <p className="text-sm text-muted">Applying the standard…</p>}
            {preview?.problems?.map((p) => <p key={p} role="alert" className="text-sm text-danger">{p}</p>)}
            {preview?.byTier && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {PRICE_TIERS.map((t) => (
                    <div key={t} className={`rounded-[var(--radius-panel)] border px-4 py-3 ${a.priceTier === t ? "border-primary bg-primary-soft" : "border-line"}`}>
                      <p className="text-sm text-muted">{PRICE_TIER_LABELS[t]}{a.priceTier === t && " (chosen)"}</p>
                      <p className="text-2xl font-bold">{money(preview.byTier![t])}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm">
                  {formatNumber(preview.lines)} lines, {formatNumber(preview.units)} units from the {preview.standardSet} standard, including {preview.contingencyPct} % contingency.
                  {preview.conditional ? ` ${preview.conditional} lines come from special conditions;` : ""}{preview.companions ? ` ${preview.companions} companion items added.` : ""}
                  {preview.unpriced ? ` ${preview.unpriced} lines have no catalogue price yet.` : ""}
                </p>
                {preview.targetBudget ? (
                  <p className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm ${(preview.chosen ?? 0) > preview.targetBudget ? "border-warn bg-warn-soft text-warn" : "border-ok bg-ok-soft text-ok"}`}>
                    {(preview.chosen ?? 0) > preview.targetBudget
                      ? `${money((preview.chosen ?? 0) - preview.targetBudget)} over the target budget of ${money(preview.targetBudget)}. Try a lower tier, or drop optional services.`
                      : `${money(preview.targetBudget - (preview.chosen ?? 0))} under the target budget of ${money(preview.targetBudget)}.`}
                  </p>
                ) : null}
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Departments</h3>
                    <div className="overflow-x-auto"><table className="w-full text-[13px]">
                      <thead className="text-left text-muted"><tr><th className="pb-1 font-semibold">Department</th><th className="pb-1 text-right font-semibold">Beds</th><th className="pb-1 text-right font-semibold">Rooms</th><th className="pb-1 text-right font-semibold">Lines</th><th className="pb-1 text-right font-semibold">Total</th></tr></thead>
                      <tbody>{preview.departments!.map((d) => (
                        <tr key={d.label} className="border-t border-line"><td className="py-1">{d.label}</td><td className="py-1 text-right">{d.beds || "—"}</td><td className="py-1 text-right">{d.rooms || "—"}</td><td className="py-1 text-right">{d.lines}</td><td className="py-1 text-right">{money(d.total)}</td></tr>
                      ))}</tbody>
                    </table></div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Biggest items at the {PRICE_TIER_LABELS[a.priceTier].toLowerCase()} tier</h3>
                    <ul className="space-y-1.5 text-[13px]">{preview.top!.map((t, i) => (
                      <li key={i}><span className="font-semibold">{t.qty} × {t.name}</span> <span className="text-muted">· {money(t.amount)}</span><span className="block text-xs text-muted">{t.why}</span></li>
                    ))}</ul>
                  </div>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold text-primary">Assumptions used ({preview.assumptions!.length})</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{preview.assumptions!.map((x) => <li key={x}>{x}</li>)}</ul>
                </details>
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <Button type="button" onClick={create} disabled={pending}>{pending ? "Creating…" : "Create BOQ"}</Button>
                  <span className="text-sm text-muted">Creates a draft BOQ you can adjust line by line before submitting it for approval.</span>
                  {a.features.length > 0 && <span className="flex flex-wrap gap-1">{a.features.map((f) => <Badge key={f} tone="info">{FEATURES.find((x) => x.key === f)?.label}</Badge>)}</span>}
                </div>
              </>
            )}
          </div>
        )}

        {step < 6 && (
          <div className="mt-6 flex gap-2 border-t border-line pt-4">
            {step > 0 && <Button type="button" variant="secondary" onClick={() => go(step - 1)}>Back</Button>}
            <Button type="button" onClick={() => go(step + 1)}>{step === 5 ? "Review the BOQ" : "Next"}</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
