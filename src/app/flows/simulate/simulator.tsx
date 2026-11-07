"use client";
/**
 * The queue simulation page's controls and results (wave 14, B3; wave 15 extras). Runs in a Web Worker (falls back to
 * the page when workers can't start); the baseline and an optional what-if, side by side. All settings live in one
 * SimScenario so a saved scenario loads in one step.
 */
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { buildRuns, cleanScenario, defaultScenario, hoursLabel, RUN_CHOICES, whatIfChanges, type SimScenario } from "@/lib/flows/scenarios";
import { fmtMinutes, simulate, UTIL_FLAG, WAIT_FLAG, type SimModel, type SimSummary } from "@/lib/flows/simulate";
import { withStaff } from "@/lib/flows/simulate-model";
import type { SimReply, SimRequest } from "@/lib/flows/simulate.worker";
import { deleteScenarioAction, saveScenarioAction, type SavedScenario } from "./actions";
import { BooksEditor, HoursEditor, MovesEditor, StaffEditor } from "./extras";

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
  const flagged = b?.resources.filter((r) => r.flag) ?? [];
  const sorted = b ? [...effective.resources].sort((x, y) => {
    const rx = b.resources.find((r) => r.key === x.key), ry = b.resources.find((r) => r.key === y.key);
    return Number(!!ry?.flag) - Number(!!rx?.flag) || (ry?.utilisation.mean ?? -1) - (rx?.utilisation.mean ?? -1);
  }) : effective.resources;
  const stale = result && JSON.stringify(result.settings) !== JSON.stringify(s);

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
            const hrs = s.hours[res.key];
            return [
              <tr key={res.key} className={`border-t border-line align-top ${r?.flag ? "bg-danger-soft/40" : ""}`}>
                <td className="px-3 py-1.5">{r ? <button type="button" onClick={() => setOpen(open === res.key ? null : res.key)} aria-expanded={open === res.key} className="text-left text-primary hover:underline">{res.label}</button> : res.label}
                  <span className="block text-[11px] text-muted">{KIND_LABEL[res.kind]}{have === 0 ? " · none found, so not limited" : ""}{hrs && hrs.close > hrs.open && !(hrs.open === 0 && hrs.close === 24 && hrs.weekends) ? ` · open ${hoursLabel(hrs)}` : ""}</span></td>
                <td className="px-2 text-right">{have}</td>
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
                  <p className="text-xs text-muted">Bars: share busy each hour of the day (red above {pct(UTIL_FLAG)}){hrs ? ", of the open time" : ""}. Orange line: patients waiting{x ? "; green line: the what-if" : ""}. Hover a bar for the figures.</p>
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
              {w && <><th className="px-2 text-right">What-if time</th><th className="px-2 text-right">What-if waiting</th></>}
            </tr></thead>
            <tbody>{b.flows.map((f) => { const x = w?.flows.find((y) => y.id === f.id); const booked = result?.settings.books[String(f.id)]; return (
              <tr key={f.id} className="border-t border-line">
                <td className="px-3 py-1.5"><a href={`/flows/${f.id}`} className="text-primary hover:underline">{f.name}</a>{booked && <span className="block text-[11px] text-muted">Booked {hoursLabel({ open: booked.from, close: booked.to, weekends: true })}{booked.noShow ? `, ${Math.round(booked.noShow * 100)} % no-shows` : ""}</span>}</td>
                <td className="px-2 text-right">{f.perDay}</td>
                <td className="px-2 text-right">{Math.round(f.finished.mean)}</td>
                {f.finished.mean < 0.5 ? <td colSpan={3} className="px-2 text-right text-xs text-muted">All still inside at the end{b.options.days === 1 ? ": long stays need a week" : ""}</td> : <>
                  <td className="px-2 text-right"><Range b={f.meanTime} fmt={fmtMinutes} /></td>
                  <td className="px-2 text-right">{fmtMinutes(f.p90Time.mean)}</td>
                  <td className="px-2 text-right"><Range b={f.meanWait} fmt={fmtMinutes} /></td>
                </>}
                {x && (x.finished.mean < 0.5 ? <td colSpan={2} className="px-2 text-right text-xs text-muted">Still inside</td>
                  : <><td className="px-2 text-right">{fmtMinutes(x.meanTime.mean)}</td><td className="px-2 text-right text-ok">{fmtMinutes(x.meanWait.mean)}</td></>)}
              </tr>
            ); })}</tbody>
          </table>
          <p className="px-3 py-2 text-xs text-muted">Patients still inside at the end of the period (long stays) aren&apos;t counted as finished.</p>
        </section>
      )}
    </div>
  );
}
