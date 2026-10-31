"use client";
import { useMemo, useState } from "react";
import { Badge, Field, Input, Select } from "@/components/ui";
import { generateLines, HOSPITAL_WIDE, TIERS, type RuleInput, type Tier } from "@/lib/boq/engine";

export interface CalcRule extends RuleInput { deviceName: string; deviceCode: string }

const TIER_TONE: Record<Tier, "primary" | "info" | "neutral"> = { ESSENTIAL: "primary", RECOMMENDED: "info", OPTIONAL: "neutral" };

/** Live preview: what this standard set produces for one department. Runs the same engine as BOQ generation. */
export function StandardCalculator({ rules, deptTypes, initialDept }: {
  rules: CalcRule[]; deptTypes: { value: string; label: string }[]; initialDept?: string;
}) {
  const usable = deptTypes.filter((d) => rules.some((r) => r.departmentTypeCode === d.value));
  const [dept, setDept] = useState(initialDept && usable.some((d) => d.value === initialDept) ? initialDept : usable[0]?.value ?? "");
  const [beds, setBeds] = useState("12");
  const [rooms, setRooms] = useState("4");
  const [instances, setInstances] = useState("1");
  const [hospitalBeds, setHospitalBeds] = useState("200");
  const [tiers, setTiers] = useState<Tier[]>(["ESSENTIAL", "RECOMMENDED"]);

  const lines = useMemo(() => {
    const n = (s: string, d = 0) => Math.max(0, Number.parseInt(s, 10) || d);
    return generateLines({
      rules: rules.filter((r) => r.departmentTypeCode === dept),
      departments: [{ id: 1, departmentTypeCode: dept, label: "Preview", beds: n(beds), rooms: n(rooms), instances: n(instances, 1) }],
      totalHospitalBeds: n(hospitalBeds), includeTiers: tiers,
    });
  }, [rules, dept, beds, rooms, instances, hospitalBeds, tiers]);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const units = lines.reduce((s, l) => s + l.calculatedQty, 0);

  if (usable.length === 0) return <p className="text-sm text-muted">Add rules to this set to preview quantities.</p>;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department type" className="col-span-2">
          <Select value={dept} onChange={(e) => setDept(e.target.value)} options={usable} />
        </Field>
        <Field label="Beds"><Input type="number" min={0} value={beds} onChange={(e) => setBeds(e.target.value)} disabled={dept === HOSPITAL_WIDE} /></Field>
        <Field label="Rooms"><Input type="number" min={0} value={rooms} onChange={(e) => setRooms(e.target.value)} /></Field>
        <Field label="Instances"><Input type="number" min={1} value={instances} onChange={(e) => setInstances(e.target.value)} /></Field>
        <Field label="Hospital beds"><Input type="number" min={0} value={hospitalBeds} onChange={(e) => setHospitalBeds(e.target.value)} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {TIERS.map((t) => (
          <label key={t} className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-[var(--color-primary)]" checked={tiers.includes(t)}
              onChange={(e) => setTiers((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))} />
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </label>
        ))}
      </div>
      <div className="mt-4" aria-live="polite">
        <p className="mb-2 text-sm font-semibold">{lines.length} lines · {units} units</p>
        {lines.length === 0 ? (
          <p className="text-sm text-muted">No lines at these inputs and tiers.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {lines.map((l) => {
              const r = byId.get(l.ruleId!)!; // no companions here, so every line has a rule
              return (
                <li key={l.ruleId} className="px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{r.deviceName}</span>
                    <span className="text-base font-bold">{l.calculatedQty}</span>
                  </div>
                  <div className="mt-0.5 flex items-start justify-between gap-2">
                    <span className="text-xs text-muted">{l.explanation}</span>
                    <Badge tone={TIER_TONE[l.tier]}>{l.tier.charAt(0) + l.tier.slice(1).toLowerCase()}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
