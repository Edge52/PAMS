"use client";
/**
 * The queue simulation page's controls and results (wave 14, B3; wave 15 extras). Runs in a Web Worker (falls back to
 * the page when workers can't start); the baseline and an optional what-if, side by side. All settings live in one
 * SimScenario so a saved scenario loads in one step. Wave 28: staff by hour, closed hours, leaving unseen, and waits by
 * hour of the day.
 */
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { buildRuns, cleanScenario, defaultScenario, hoursLabel, RUN_CHOICES, whatIfChanges, type SimScenario } from "@/lib/flows/scenarios";
import { closedLabel, fmtMinutes, simulate, UTIL_FLAG, WAIT_FLAG, type SimModel, type SimSummary } from "@/lib/flows/simulate";
import { withStaff } from "@/lib/flows/simulate-model";
import type { SimReply, SimRequest } from "@/lib/flows/simulate.worker";
import { deleteScenarioAction, saveScenarioAction, type SavedScenario } from "./actions";
import { BooksEditor, ClosedEditor, HoursEditor, LeaveEditor, MovesEditor, ShiftsEditor, StaffEditor } from "./extras";

const KIND_LABEL = { room: "Rooms", bed: "Beds", scanner: "Scanners", porter: "Porters", lift: "Lifts", staff: "Staff" } as const;
const pct = (u: number) => `${Math.round(u * 100)} %`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function Range({ b, fmt }: { b: { mean: number; low: number; high: number }; fmt: (x: number) => string }) {
  const same = fmt(b.low) === fmt(b.high);
  return <span>{fmt(b.mean)}{!same && <span className="block text-[11px] text-muted">{fmt(b.low)}–{fmt(b.high)}</span>}</span>;
}

/** Busy share by hour of the day: bars for the baseline, a line for the what-if. */
function HourChart({ base, what, queue }: { base: number[]; what?: number[]; queue: number[] }) {
  const W = 480, H = 120, L = 28, B = 18, T = 6, bw = (W - L) / 24;
  const y = (v: number) => T + (1 - Math.min(1.2, v) / 1.2) * (H - T - B);
  const qmax = Math.max(1, ...queue);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label="Busy share by hour of the day">
      {[0, 0.5, 1].map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--color-line)" /><text x={L - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill="var(--color-muted)">{v * 100}%</text></g>)}
      <line x1={L} x2={W} y1={y(UTIL_FLAG)} y2={y(UTIL_FLAG)} stroke="var(--color-danger)" strokeDasharray="3 3" />
      {base.map((v, h) => <rect key={h} x={L + h * bw + 1} y={y(v)} width={bw - 2} height={Math.max(0, H - B - y(v))} fill={v > UTIL_FLAG ? "var(--color-danger)" : "var(--color-info)"} opacity={0.75}><title>{`${hh(h)}: ${pct(v)} busy, ${queue[h].toFixed(1)} waiting on average`}</title></rect>)}
      {queue.some((x) => x > 0.05) && <polyline points={queue.map((v, h) => `${L + h * bw + bw / 2},${T + (1 - v / qmax) * (H - T - B)}`).join(" ")} fill="none" stroke="var(--color-warn)" strokeWidth={1.5} />}
      {what && <polyline points={what.map((v, h) => `${L + h * bw + bw / 2},${y(v)}`).join(" ")} fill="none" stroke="var(--color-ok)" strokeWidth={2} />}
      {[0, 6, 12, 18].map((h) => <text key={h} x={L + h * bw + bw / 2} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--color-muted)">{hh(h)}</text>)}
    </svg>
  );
}

/** Average wait (minutes) by hour of the day (wave 28): bars for the baseline, a line for the what-if. */
export function WaitChart({ base, what, label, count }: { base: number[]; what?: number[]; label: string; count?: number[] }) {
  const W = 480, H = 110, L = 34, B = 18, T = 6, bw = (W - L) / 24;
  const top = Math.max(10, ...base, ...(what ?? []));
  const step = top > 240 ? 120 : top > 120 ? 60 : top > 40 ? 20 : 5;
  const max = Math.ceil(top / step) * step;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step).filter((_, i, a) => a.length <= 5 || i % 2 === 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label={`${label}. Longest: ${fmtMinutes(Math.max(...base))} for patients arriving at ${hh(base.indexOf(Math.max(...base)))}.`}>
      {ticks.map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--color-line)" /><text x={L - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill="var(--color-muted)">{v} min</text></g>)}
      {base.map((v, h) => <rect key={h} x={L + h * bw + 1} y={y(v)} width={bw - 2} height={Math.max(0, H - B - y(v))} fill={v > WAIT_FLAG ? "var(--color-warn)" : "var(--color-info)"} opacity={0.75}>
        <title>{`${hh(h)}: ${fmtMinutes(v)} average wait${count ? `, ${count[h].toFixed(1)} patients a day` : ""}`}</title></rect>)}
      {what && <polyline points={what.map((v, h) => `${L + h * bw + bw / 2},${y(v)}`).join(" ")} fill="none" stroke="var(--color-ok)" strokeWidth={2} />}
      {[0, 6, 12, 18].map((h) => <text key={h} x={L + h * bw + bw / 2} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--color-muted)">{hh(h)}</text>)}
    </svg>
  );
}

/** Saved scenarios: load one, save the current settings, delete your own (an administrator any). */
function ScenarioBar({ facilityId, scenarios, setScenarios, current, onLoad, canDeleteAll }: {
  facilityId: number; scenarios: SavedScenario[]; setScenarios: (f: (x: SavedScenario[]) => SavedScenario[]) => void;
  current: SimScenario; onLoad: (s: SavedScenario | null) => void; canDeleteAll: boolean;
}) {
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = scenarios.find((x) => String(x.id) === pick) ?? null;
  const input = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
  const save = async () => {
    setBusy(true);
    const r = await saveScenarioAction({ facilityId, name, shared, settings: current });
    setBusy(false); setMsg(r);
    if (r.scenario) { const sc = r.scenario; setScenarios((x) => [sc, ...x]); setPick(String(sc.id)); setName(""); }
  };
  const remove = async () => {
    if (!chosen) return;
    setBusy(true);
    const r = await deleteScenarioAction(chosen.id);
    setBusy(false); setMsg(r);
    if (r.deletedId) { setScenarios((x) => x.filter((y) => y.id !== r.deletedId)); setPick(""); }
  };
  return (
    <section aria-label="Scenarios" className="flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3">
      <label className="text-sm">Saved scenario
        <select className={`${input} block min-w-56`} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{scenarios.length ? "Choose one…" : "None saved yet"}</option>
          {scenarios.map((x) => <option key={x.id} value={x.id}>{x.name}{x.shared ? " · shared" : ""}{!x.mine && x.by ? ` · ${x.by}` : ""}</option>)}
        </select>
      </label>
      <Button type="button" variant="secondary" disabled={!chosen || busy} onClick={() => { onLoad(chosen); setMsg({ ok: `Loaded “${chosen!.name}”. Run it to see the results.` }); }}>Load</Button>
      {chosen && (chosen.mine || canDeleteAll) && <Button type="button" variant="secondary" disabled={busy} onClick={remove}>Delete</Button>}
      <Button type="button" variant="secondary" disabled={busy} onClick={() => { onLoad(null); setPick(""); setMsg({ ok: "Back to the default settings." }); }}>Start again</Button>
      <span className="hidden h-9 w-px bg-line sm:block" />
      <label className="text-sm">Save these settings as
        <input className={`${input} block w-56`} value={name} maxLength={80} placeholder="e.g. MRI open till 22:00" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex h-9 items-center gap-1.5 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with everyone</label>
      <Button type="button" disabled={!name.trim() || busy} onClick={save}>Save scenario</Button>
      {msg && <p role="status" className={`w-full text-sm ${msg.error ? "text-danger" : "text-ok"}`}>{msg.error ?? msg.ok}</p>}
    </section>
  );
}

export function Simulator({ model, porterDefault, facilityId, floors, scenarios: initialScenarios, canDeleteAll }: {
  model: SimModel; porterDefault: number; facilityId: number; floors: { level: number; name: string }[]; scenarios: SavedScenario[]; canDeleteAll: boolean;
}) {
  const [s, setS] = useState<SimScenario>(() => defaultScenario(porterDefault));
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [busy, setBusy] = useState<{ done: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ base: SimSummary; whatIf: SimSummary | null; settings: SimScenario } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openFlow, setOpenFlow] = useState<number | null>(null);
  const worker = useRef<Worker | null>(null);
  const set = (f: (x: SimScenario) => SimScenario) => setS(f);

  const effective = useMemo(() => withStaff(model, s.staff), [model, s.staff]);
  const changes = whatIfChanges(model, s, (l) => floors.find((f) => f.level === l)?.name ?? `level ${l}`);

  const run = () => {
    const { model: m, base, whatIf } = buildRuns(model, s);
    setError(null); setBusy({ done: 0, of: s.runs * (whatIf ? 2 : 1) });
    const req: SimRequest = { model: m, base, whatIf };
    const settings = s;
    const onReply = (r: SimReply) => {
      if (r.kind === "progress") setBusy({ done: r.done, of: r.of });
      else if (r.kind === "done") { setBusy(null); setResult({ base: r.base, whatIf: r.whatIf, settings }); setOpen((o) => o ?? r.base.resources.find((x) => x.flag)?.key ?? r.base.resources[0]?.key ?? null); }
      else { setBusy(null); setError(r.message); }
    };
    try {
      worker.current?.terminate();
      const w = new Worker(new URL("../../../lib/flows/simulate.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      w.onmessage = (e: MessageEvent<SimReply>) => onReply(e.data);
      w.onerror = () => { w.terminate(); worker.current = null; runHere(req, onReply); };
      w.postMessage(req);
    } catch { runHere(req, onReply); }
  };
  const runHere = (req: SimRequest, onReply: (m: SimReply) => void) => {
    // Workers unavailable: run on the page after it has painted the progress line.
    setTimeout(() => { try { onReply({ kind: "done", base: simulate(req.model, req.base), whatIf: req.whatIf ? simulate(req.model, req.whatIf) : null }); } catch (e) { onReply({ kind: "error", message: (e as Error).message }); } }, 30);
  };

  const num = (v: string, k: "weekend" | "walk" | "volume" | "porters", min: number, max: number) => { const n = Number(v); if (Number.isFinite(n)) set((x) => ({ ...x, [k]: Math.min(max, Math.max(min, n)) })); };
  const setCap = (k: string, v: string) => set((x) => { const c = { ...x.whatIf.capacity }; const d = v.replace(/[^\d]/g, ""); if (d === "") delete c[k]; else c[k] = Math.min(1000, Number(d)); return { ...x, whatIf: { ...x.whatIf, capacity: c } }; });
  const input = "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
  const b = result?.base, w = result?.whatIf;
  // The three editors below work on the baseline, or on the what-if's own copy (started from the baseline's).
  const [side, setSide] = useState<"base" | "whatIf">("base");
  const view: SimScenario = side === "base" ? s
    : { ...s, shifts: s.whatIf.shifts ?? s.shifts, closed: s.whatIf.closed ?? s.closed, leaveAfter: s.whatIf.leaveAfter ?? s.leaveAfter };
  const setView = side === "base" ? set : (f: (x: SimScenario) => SimScenario) => set((x) => {
    const cur = { ...x, shifts: x.whatIf.shifts ?? x.shifts, closed: x.whatIf.closed ?? x.closed, leaveAfter: x.whatIf.leaveAfter ?? x.leaveAfter };
    const next = f(cur);
    return { ...x, leaveAny: next.leaveAny, whatIf: { ...x.whatIf, shifts: next.shifts, closed: next.closed, leaveAfter: next.leaveAfter } };
  });
  const flagged = b?.resources.filter((r) => r.flag) ?? [];
  const sorted = b ? [...effective.resources].sort((x, y) => {
    const rx = b.resources.find((r) => r.key === x.key), ry = b.resources.find((r) => r.key === y.key);
    return Number(!!ry?.flag) - Number(!!rx?.flag) || (ry?.utilisation.mean ?? -1) - (rx?.utilisation.mean ?? -1);
  }) : effective.resources;
  const stale = result && JSON.stringify(result.settings) !== JSON.stringify(s);
  const leaving = !!result && (Object.keys(result.settings.leaveAfter).length > 0 || !!b?.flows.some((f) => f.left.mean > 0));

  return (
    <div className="space-y-5">
      <ScenarioBar facilityId={facilityId} scenarios={scenarios} setScenarios={setScenarios} current={s} canDeleteAll={canDeleteAll}
        onLoad={(sc) => { setS(sc ? cleanScenario(sc.settings, porterDefault) : defaultScenario(porterDefault)); setResult(null); }} />

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Settings">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <label className="text-sm">Period<select className={input} value={s.days} onChange={(e) => set((x) => ({ ...x, days: Number(e.target.value) === 7 ? 7 : 1 }))}><option value={1}>A day</option><option value={7}>A week</option></select></label>
          <label className="text-sm">Runs<select className={input} value={s.runs} onChange={(e) => set((x) => ({ ...x, runs: Number(e.target.value) }))}>{RUN_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="text-sm">Step times vary<select className={input} value={s.variability} onChange={(e) => set((x) => ({ ...x, variability: Number(e.target.value) }))}><option value={0}>Not at all</option><option value={0.25}>A little</option><option value={0.5}>Normally</option><option value={1}>A lot</option></select></label>
          <label className="text-sm">Patients, % of set<input className={input} inputMode="numeric" value={s.volume} onChange={(e) => num(e.target.value, "volume", 1, 1000)} /></label>
          <label className="text-sm">What-if patients, %<input className={input} inputMode="numeric" value={s.whatIf.volume ?? ""} placeholder={String(s.volume)} onChange={(e) => { const d = e.target.value.replace(/[^\d]/g, ""); set((x) => ({ ...x, whatIf: { ...x.whatIf, volume: d && Number(d) > 0 ? Math.min(1000, Number(d)) : null } })); }} /></label>
          {s.days === 7 && <label className="text-sm">Weekends, % of a weekday<input className={input} inputMode="numeric" value={s.weekend} onChange={(e) => num(e.target.value, "weekend", 0, 200)} /></label>}
          <label className="text-sm">Walk between steps, min<input className={input} inputMode="decimal" value={s.walk} onChange={(e) => num(e.target.value, "walk", 0, 60)} /></label>
          {model.porter && <label className="text-sm">Porters on duty<input className={input} inputMode="numeric" value={s.porters} onChange={(e) => num(e.target.value, "porters", 0, 200)} /></label>}
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          <StaffEditor model={model} s={s} set={set} />
          <HoursEditor model={effective} s={s} set={set} />
          <BooksEditor model={model} s={s} set={set} />
          <MovesEditor model={model} s={s} set={set} floors={floors} />
        </div>
        {/* Wave 29: shifts, closed hours and leave-unseen limits can differ in the what-if. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="radiogroup" aria-label="Which run the next three settings change">
          <span className="text-muted">Shifts, closed hours and leaving apply to:</span>
          {(["base", "whatIf"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={side === k} onClick={() => setSide(k)}
              className={`min-h-8 rounded-full border px-3 ${side === k ? "border-primary bg-primary text-white" : "border-line bg-surface"}`}>
              {k === "base" ? "The baseline" : "The what-if"}
            </button>
          ))}
          {side === "whatIf" && (s.whatIf.shifts || s.whatIf.closed || s.whatIf.leaveAfter) && (
            <button type="button" className="min-h-8 text-primary underline" onClick={() => set((x) => { const w = { ...x.whatIf }; delete w.shifts; delete w.closed; delete w.leaveAfter; return { ...x, whatIf: w }; })}>Same as the baseline again</button>
          )}
        </div>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <ShiftsEditor model={effective} s={view} set={setView} />
          <ClosedEditor model={effective} s={view} set={setView} />
          <LeaveEditor model={model} s={view} set={setView} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={run} disabled={!!busy}>{busy ? `Running ${busy.done} of ${busy.of}…` : result ? "Run again" : "Run the simulation"}</Button>
          <span className="text-xs text-muted">{changes.length ? `What-if: ${changes.join(", ")}` : "To compare a change, type new numbers in the What-if column below, other opening hours or a step on another floor, then run."}</span>
        </div>
        {stale && !busy && <p className="mt-2 text-xs text-warn">The settings have changed since the last run: run again to update the results.</p>}
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </section>

      {b && (
        <p className="text-sm" role="status">
          {flagged.length ? <b className="text-danger">{flagged.length} of {b.resources.length} resources are busy above {pct(UTIL_FLAG)} on average, or one patient in ten waits over {WAIT_FLAG} minutes.</b> : <span className="text-ok">No resource is over the flag levels.</span>}{" "}
          <span className="text-muted">{b.runs} runs of {b.options.days === 7 ? "a week" : "a day"}, after a day to fill the beds; ranges are the middle 90 % of runs.</span>
        </p>
      )}

      <section aria-label="Resources" className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-sunken text-left text-xs text-muted"><tr>
            <th className="px-3 py-2">Resource</th><th className="px-2 text-right">Have</th><th className="px-2">What-if</th>
            {b && <><th className="px-2 text-right">Busy</th><th className="px-2 text-right">Average wait</th><th className="px-2 text-right">1 in 10 waits over</th><th className="px-2 text-right">Longest queue</th><th className="px-2 text-right">Busiest hour</th></>}
            {w && <><th className="px-2 text-right">What-if busy</th><th className="px-2 text-right">What-if wait</th></>}
          </tr></thead>
          <tbody>{sorted.map((res) => {
            const r = b?.resources.find((x) => x.key === res.key), x = w?.resources.find((y) => y.key === res.key);
            const have = res.key === "porter" ? s.porters : res.capacity;
            const hrs = s.hours[res.key], shift = s.shifts[res.key], shut = s.closed[res.key];
            return [
              <tr key={res.key} className={`border-t border-line align-top ${r?.flag ? "bg-danger-soft/40" : ""}`}>
                <td className="px-3 py-1.5">{r ? <button type="button" onClick={() => setOpen(open === res.key ? null : res.key)} aria-expanded={open === res.key} className="text-left text-primary hover:underline">{res.label}</button> : res.label}
                  <span className="block text-[11px] text-muted">{KIND_LABEL[res.kind]}{have === 0 ? " · none found, so not limited" : ""}{hrs && hrs.close > hrs.open && !(hrs.open === 0 && hrs.close === 24 && hrs.weekends) ? ` · open ${hoursLabel(hrs)}` : ""}{shift ? " · by hour" : ""}{shut?.length ? ` · closed ${closedLabel(shut)}` : ""}</span></td>
                <td className="px-2 text-right">{shift ? (Math.min(...shift) === Math.max(...shift) ? shift[0] : `${Math.min(...shift)}–${Math.max(...shift)}`) : have}</td>
                <td className="px-2"><input aria-label={`What-if ${res.label}`} inputMode="numeric" className="h-8 w-16 rounded border border-line bg-surface px-2 text-sm" value={s.whatIf.capacity[res.key] ?? ""} placeholder={String(have)} onChange={(e) => setCap(res.key, e.target.value)} /></td>
                {b && (r ? <>
                  <td className={`px-2 text-right ${r.utilisation.mean > UTIL_FLAG ? "font-semibold text-danger" : ""}`}>{r.capacity ? <Range b={r.utilisation} fmt={pct} /> : "—"}</td>
                  <td className="px-2 text-right"><Range b={r.meanWait} fmt={fmtMinutes} /></td>
                  <td className={`px-2 text-right ${r.p90Wait.mean > WAIT_FLAG ? "font-semibold text-danger" : ""}`}><Range b={r.p90Wait} fmt={fmtMinutes} /></td>
                  <td className="px-2 text-right">{Math.round(r.maxQueue.mean)}</td>
                  <td className="px-2 text-right">{r.capacity ? hh(r.peakHour) : "—"}</td>
                </> : <td colSpan={5} className="px-2 text-right text-xs text-muted">Not in the last run</td>)}
                {w && (x ? <>
                  <td className={`px-2 text-right ${x.utilisation.mean > UTIL_FLAG ? "font-semibold text-danger" : "text-ok"}`}>{x.capacity ? <Range b={x.utilisation} fmt={pct} /> : "—"}</td>
                  <td className="px-2 text-right"><Range b={x.meanWait} fmt={fmtMinutes} /></td>
                </> : <td colSpan={2} />)}
              </tr>,
              open === res.key && r && (
                <tr key={`${res.key}-chart`} className="border-t border-line/50"><td colSpan={w ? 10 : 8} className="px-3 py-2">
                  <HourChart base={r.hourly} what={x?.hourly} queue={r.queueHourly} />
                  <p className="text-xs text-muted">Bars: share busy each hour of the day (red above {pct(UTIL_FLAG)}){hrs || shut || shift ? ", of the time open and the units on duty" : ""}. Orange line: patients waiting{x ? "; green line: the what-if" : ""}. Hover a bar for the figures.</p>
                  {r.waitHourly.some((v) => v >= 0.5) && <>
                    <h3 className="mt-2 text-xs font-semibold">Average wait by the hour it began</h3>
                    <WaitChart label={`Average wait for ${res.label} by hour of the day`} base={r.waitHourly} what={x?.waitHourly} />
                  </>}
                </td></tr>
              ),
            ];
          })}</tbody>
        </table>
      </section>

      {b && (
        <section aria-label="Pathways" className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-left text-xs text-muted"><tr>
              <th className="px-3 py-2">Pathway</th><th className="px-2 text-right">Patients a day (set)</th><th className="px-2 text-right">Finished in the period</th>
              <th className="px-2 text-right">Time in the pathway</th><th className="px-2 text-right">1 in 10 take over</th><th className="px-2 text-right">Of which waiting</th>
              {leaving && <th className="px-2 text-right">Left unseen</th>}
              {w && <><th className="px-2 text-right">What-if time</th><th className="px-2 text-right">What-if waiting</th>{leaving && <th className="px-2 text-right">What-if left unseen</th>}</>}
              <th className="px-2"><span className="sr-only">Waits by hour</span></th>
            </tr></thead>
            <tbody>{b.flows.map((f) => { const x = w?.flows.find((y) => y.id === f.id); const booked = result?.settings.books[String(f.id)]; const limit = result?.settings.leaveAfter[String(f.id)]; return [
              <tr key={f.id} className="border-t border-line">
                <td className="px-3 py-1.5"><a href={`/flows/${f.id}`} className="text-primary hover:underline">{f.name}</a>{booked && <span className="block text-[11px] text-muted">Booked {hoursLabel({ open: booked.from, close: booked.to, weekends: true })}{booked.noShow ? `, ${Math.round(booked.noShow * 100)} % no-shows` : ""}</span>}
                  {limit && <span className="block text-[11px] text-muted">Leave unseen after {fmtMinutes(limit)}</span>}</td>
                <td className="px-2 text-right">{f.perDay}</td>
                <td className="px-2 text-right">{Math.round(f.finished.mean)}</td>
                {f.finished.mean < 0.5 ? <td colSpan={3} className="px-2 text-right text-xs text-muted">All still inside at the end{b.options.days === 1 ? ": long stays need a week" : ""}</td> : <>
                  <td className="px-2 text-right"><Range b={f.meanTime} fmt={fmtMinutes} /></td>
                  <td className="px-2 text-right">{fmtMinutes(f.p90Time.mean)}</td>
                  <td className="px-2 text-right"><Range b={f.meanWait} fmt={fmtMinutes} /></td>
                </>}
                {leaving && <td className={`px-2 text-right ${f.left.mean >= 0.5 ? "font-semibold text-danger" : ""}`}>{limit || f.left.mean > 0 ? <Range b={f.left} fmt={(v) => String(Math.round(v))} /> : "—"}</td>}
                {x && (x.finished.mean < 0.5 ? <td colSpan={2} className="px-2 text-right text-xs text-muted">Still inside</td>
                  : <><td className="px-2 text-right">{fmtMinutes(x.meanTime.mean)}</td><td className="px-2 text-right text-ok">{fmtMinutes(x.meanWait.mean)}</td></>)}
                {x && leaving && <td className="px-2 text-right">{Math.round(x.left.mean)}</td>}
                <td className="px-2 text-right"><button type="button" className="min-h-6 text-sm text-primary hover:underline" aria-expanded={openFlow === f.id} onClick={() => setOpenFlow(openFlow === f.id ? null : f.id)}>Waits by hour</button></td>
              </tr>,
              openFlow === f.id && (
                <tr key={`${f.id}-hours`} className="border-t border-line/50"><td colSpan={7 + (leaving ? 1 : 0) + (w ? 2 + (leaving ? 1 : 0) : 0)} className="px-3 py-2">
                  {f.waitByHour.some((v) => v >= 0.5) ? <>
                    <WaitChart label={`Average wait in ${f.name} by hour of arrival`} base={f.waitByHour} what={x?.waitByHour} count={f.patientsByHour} />
                    <p className="text-xs text-muted">Average time each patient spent waiting in all, by the hour they arrived (orange above {WAIT_FLAG} minutes){x ? "; green line: the what-if" : ""}{limit ? ". Patients who left unseen count with the time they waited" : ""}. Hover a bar for the figures.</p>
                  </> : <p className="text-sm text-muted">Nobody in this pathway waited, at any hour.</p>}
                </td></tr>
              ),
            ]; })}</tbody>
          </table>
          <p className="px-3 py-2 text-xs text-muted">Patients still inside at the end of the period (long stays) aren&apos;t counted as finished{leaving ? "; nor are those who left unseen" : ""}.</p>
        </section>
      )}
    </div>
  );
}
