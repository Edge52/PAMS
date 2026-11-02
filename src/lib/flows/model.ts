/**
 * Patient pathways (wave 7, step 7b): the model, the checks run while editing, patients per step and the automatic
 * diagram layout. Pure.
 */

export const STEP_KINDS = ["START", "STEP", "END"] as const;
export const TRANSPORTS = ["FOOT", "WHEELCHAIR", "TROLLEY", "BED"] as const;
export const URGENCIES = ["ROUTINE", "URGENT"] as const;
export const FLOW_KINDS = ["PATIENT", "STAFF", "SUPPLIES", "WASTE"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export type Transport = (typeof TRANSPORTS)[number];
export type Urgency = (typeof URGENCIES)[number];
export type FlowKind = (typeof FLOW_KINDS)[number];

export const STEP_KIND_LABELS: Record<StepKind, string> = { START: "Start", STEP: "Step", END: "End" };
export const TRANSPORT_LABELS: Record<Transport, string> = { FOOT: "On foot", WHEELCHAIR: "Wheelchair", TROLLEY: "Trolley", BED: "Bed" };
export const FLOW_KIND_LABELS: Record<FlowKind, string> = { PATIENT: "Patient", STAFF: "Staff", SUPPLIES: "Clean supplies", WASTE: "Dirty / waste" };

export type Step = {
  key: string; label: string; kind: StepKind;
  departmentId: number | null; roomId: number | null;
  minutes: number | null; accompanying: string | null; equipment: string[]; notes: string | null;
};
export type Link = { fromKey: string; toKey: string; share: number; transport: Transport; urgency: Urgency; condition: string | null };
export type Issue = { level: "error" | "warning"; message: string; stepKey?: string };

/** Problems with a pathway, errors first. Publishing needs no errors; warnings are shown but allowed. */
export function checkFlow(steps: Step[], links: Link[]): Issue[] {
  const out: Issue[] = [];
  const keys = new Set(steps.map((s) => s.key));
  const name = (k: string) => steps.find((s) => s.key === k)?.label ?? k;
  const starts = steps.filter((s) => s.kind === "START"), ends = steps.filter((s) => s.kind === "END");
  if (!steps.length) return [{ level: "error", message: "Add the pathway's steps: a start, the places patients go, and an end." }];
  if (!starts.length) out.push({ level: "error", message: "No start step: mark where patients enter the pathway (arrival)." });
  if (!ends.length) out.push({ level: "error", message: "No end step: mark where patients leave it (discharge, transfer)." });
  const valid = links.filter((l) => keys.has(l.fromKey) && keys.has(l.toKey));
  for (const l of links) {
    if (!keys.has(l.fromKey) || !keys.has(l.toKey)) out.push({ level: "error", message: `An arrow points to a step that no longer exists (${l.fromKey} → ${l.toKey}).` });
    else if (l.fromKey === l.toKey) out.push({ level: "error", message: `${name(l.fromKey)} has an arrow to itself.`, stepKey: l.fromKey });
  }
  const seen = new Set<string>();
  for (const l of valid) {
    const k = `${l.fromKey}>${l.toKey}`;
    if (seen.has(k)) out.push({ level: "warning", message: `Two arrows from ${name(l.fromKey)} to ${name(l.toKey)}: merge them into one share.`, stepKey: l.fromKey });
    seen.add(k);
  }
  const outOf = (k: string) => valid.filter((l) => l.fromKey === k && l.toKey !== k);
  // Reachable from a start.
  const reach = new Set<string>(starts.map((s) => s.key));
  for (let changed = true; changed;) {
    changed = false;
    for (const l of valid) if (reach.has(l.fromKey) && !reach.has(l.toKey)) { reach.add(l.toKey); changed = true; }
  }
  for (const s of steps) if (!reach.has(s.key)) out.push({ level: "error", message: `${s.label} can't be reached from a start step.`, stepKey: s.key });
  // Can reach an end.
  const toEnd = new Set<string>(ends.map((s) => s.key));
  for (let changed = true; changed;) {
    changed = false;
    for (const l of valid) if (toEnd.has(l.toKey) && !toEnd.has(l.fromKey)) { toEnd.add(l.fromKey); changed = true; }
  }
  for (const s of steps) {
    const o = outOf(s.key);
    if (s.kind === "STEP" && s.departmentId == null && s.roomId == null) out.push({ level: "warning", message: `${s.label} has no place: choose a department or room so it can be shown in the building.`, stepKey: s.key });
    if (s.kind === "END") { if (o.length) out.push({ level: "warning", message: `${s.label} is an end step but has arrows leaving it.`, stepKey: s.key }); continue; }
    if (!o.length) { out.push({ level: "error", message: `${s.label} goes nowhere: add an arrow to the next step.`, stepKey: s.key }); continue; }
    if (!toEnd.has(s.key)) out.push({ level: "error", message: `From ${s.label} patients go round in a loop and never reach an end.`, stepKey: s.key });
    const sum = o.reduce((t, l) => t + l.share, 0);
    if (sum !== 100) out.push({ level: "error", message: `The arrows leaving ${s.label} add up to ${sum} %, not 100 %.`, stepKey: s.key });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

/**
 * Patients a day at each step: the daily volume enters evenly at the start steps and flows along the arrows by
 * their shares. Loops (a return to CT, say) are followed until the numbers settle.
 */
export function stepVolumes(steps: Step[], links: Link[], daily: number): Map<string, number> {
  const starts = steps.filter((s) => s.kind === "START");
  const keys = new Set(steps.map((s) => s.key));
  const valid = links.filter((l) => keys.has(l.fromKey) && keys.has(l.toKey) && l.fromKey !== l.toKey);
  const entry = new Map(starts.map((s) => [s.key, daily / Math.max(1, starts.length)]));
  let v = new Map(steps.map((s) => [s.key, entry.get(s.key) ?? 0]));
  for (let it = 0; it < 500; it++) {
    const next = new Map(steps.map((s) => [s.key, entry.get(s.key) ?? 0]));
    for (const l of valid) next.set(l.toKey, next.get(l.toKey)! + (v.get(l.fromKey)! * l.share) / 100);
    let diff = 0; for (const [k, x] of next) diff = Math.max(diff, Math.abs(x - v.get(k)!));
    v = next;
    if (diff < 1e-6) break;
  }
  return v;
}

/** Diagram layout: columns by longest path from a start (arrows back to earlier steps ignored), rows in order. */
export function layoutFlow(steps: Step[], links: Link[]): Map<string, { col: number; row: number }> {
  const keys = steps.map((s) => s.key);
  const outs = new Map(keys.map((k) => [k, links.filter((l) => l.fromKey === k && keys.includes(l.toKey) && l.toKey !== k).map((l) => l.toKey)]));
  // Back edges: found by depth-first search from the starts.
  const state = new Map<string, 0 | 1 | 2>(), back = new Set<string>();
  const dfs = (k: string) => {
    state.set(k, 1);
    for (const t of outs.get(k) ?? []) {
      if (state.get(t) === 1) back.add(`${k}>${t}`);
      else if (!state.get(t)) dfs(t);
    }
    state.set(k, 2);
  };
  for (const s of steps.filter((x) => x.kind === "START")) if (!state.get(s.key)) dfs(s.key);
  for (const k of keys) if (!state.get(k)) dfs(k);
  const col = new Map(keys.map((k) => [k, 0]));
  for (let it = 0; it < keys.length; it++) {
    let changed = false;
    for (const [k, ts] of outs) for (const t of ts) if (!back.has(`${k}>${t}`) && col.get(t)! < col.get(k)! + 1) { col.set(t, col.get(k)! + 1); changed = true; }
    if (!changed) break;
  }
  // End steps in the last column.
  const last = Math.max(0, ...col.values());
  for (const s of steps) if (s.kind === "END") col.set(s.key, last);
  const rows = new Map<number, number>();
  const out = new Map<string, { col: number; row: number }>();
  for (const k of keys) { const c = col.get(k)!; const r = rows.get(c) ?? 0; rows.set(c, r + 1); out.set(k, { col: c, row: r }); }
  return out;
}

/** A short step key not yet used ("s1", "s2"…). */
export function nextKey(used: string[]): string {
  for (let i = 1; ; i++) if (!used.includes(`s${i}`)) return `s${i}`;
}

/** Even arrival profile over the 24 hours. */
export const EVEN_PROFILE = Array.from({ length: 24 }, () => 1 / 24);
/** Peak hour's share of the day (for load at the busiest hour, step 7d). */
export const peakShare = (profile: number[] | null | undefined) => Math.max(...(profile?.length === 24 ? profile : EVEN_PROFILE));
