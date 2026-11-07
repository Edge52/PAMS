"use client";
/**
 * The queue simulation page's controls and results (wave 14, B3). Runs in a Web Worker (falls back to the page when
 * workers can't start); the baseline and an optional what-if with changed capacities, side by side.
 */
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { fmtMinutes, simulate, UTIL_FLAG, WAIT_FLAG, type SimModel, type SimOptions, type SimSummary } from "@/lib/flows/simulate";
import type { SimReply, SimRequest } from "@/lib/flows/simulate.worker";

const KIND_LABEL = { room: "Rooms", bed: "Beds", scanner: "Scanners", porter: "Porters", lift: "Lifts" } as const;
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

export function Simulator({ model, porterDefault }: { model: SimModel; porterDefault: number }) {
  const [days, setDays] = useState<1 | 7>(1);
  const [runs, setRuns] = useState(20);
  const [variability, setVariability] = useState(0.5);
  const [weekend, setWeekend] = useState(60);
  const [walk, setWalk] = useState(3);
  const [volume, setVolume] = useState(100);
  const [porters, setPorters] = useState(porterDefault);
  const [whatIf, setWhatIf] = useState<Record<string, string>>({});
  const [whatVolume, setWhatVolume] = useState("");
  const [busy, setBusy] = useState<{ done: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ base: SimSummary; whatIf: SimSummary | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);

  const changed = Object.entries(whatIf).filter(([k, v]) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) !== (model.resources.find((r) => r.key === k)?.capacity ?? -1));
  const whatVol = whatVolume.trim() && Number(whatVolume) > 0 && Number(whatVolume) !== volume ? Number(whatVolume) : null;

  const run = () => {
    const base: Partial<SimOptions> = { days, runs, variability, weekendShare: weekend / 100, walkMinutes: walk, volumeFactor: volume / 100, seed: 1, ...(model.porter ? { capacity: { porter: porters } } : {}) };
    const what: Partial<SimOptions> | null = changed.length || whatVol ? { ...base, volumeFactor: (whatVol ?? volume) / 100, capacity: { ...base.capacity, ...Object.fromEntries(changed.map(([k, v]) => [k, Number(v)])) } } : null;
    setError(null); setBusy({ done: 0, of: runs * (what ? 2 : 1) });
    const req: SimRequest = { model, base, whatIf: what };
    const onReply = (m: SimReply) => {
      if (m.kind === "progress") setBusy({ done: m.done, of: m.of });
      else if (m.kind === "done") { setBusy(null); setResult({ base: m.base, whatIf: m.whatIf }); setOpen((o) => o ?? m.base.resources.find((r) => r.flag)?.key ?? m.base.resources[0]?.key ?? null); }
      else { setBusy(null); setError(m.message); }
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

  const num = (v: string, set: (n: number) => void, min: number, max: number) => { const n = Number(v); if (Number.isFinite(n)) set(Math.min(max, Math.max(min, n))); };
  const input = "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
  const b = result?.base, w = result?.whatIf;
  const flagged = b?.resources.filter((r) => r.flag) ?? [];
  const sorted = b ? [...b.resources].sort((x, y) => Number(y.flag) - Number(x.flag) || y.utilisation.mean - x.utilisation.mean) : model.resources;

  return (
    <div className="space-y-5">
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Settings">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <label className="text-sm">Period<select className={input} value={days} onChange={(e) => setDays(Number(e.target.value) as 1 | 7)}><option value={1}>A day</option><option value={7}>A week</option></select></label>
          <label className="text-sm">Runs<select className={input} value={runs} onChange={(e) => setRuns(Number(e.target.value))}>{[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="text-sm">Step times vary<select className={input} value={variability} onChange={(e) => setVariability(Number(e.target.value))}><option value={0}>Not at all</option><option value={0.25}>A little</option><option value={0.5}>Normally</option><option value={1}>A lot</option></select></label>
          <label className="text-sm">Patients, % of set<input className={input} inputMode="numeric" value={volume} onChange={(e) => num(e.target.value, setVolume, 1, 1000)} /></label>
          <label className="text-sm">What-if patients, %<input className={input} inputMode="numeric" value={whatVolume} placeholder={String(volume)} onChange={(e) => setWhatVolume(e.target.value.replace(/[^\d]/g, ""))} /></label>
          {days === 7 && <label className="text-sm">Weekends, % of a weekday<input className={input} inputMode="numeric" value={weekend} onChange={(e) => num(e.target.value, setWeekend, 0, 200)} /></label>}
          <label className="text-sm">Walk between steps, min<input className={input} inputMode="decimal" value={walk} onChange={(e) => num(e.target.value, setWalk, 0, 60)} /></label>
          {model.porter && <label className="text-sm">Porters on duty<input className={input} inputMode="numeric" value={porters} onChange={(e) => num(e.target.value, setPorters, 0, 200)} /></label>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={run} disabled={!!busy}>{busy ? `Running ${busy.done} of ${busy.of}…` : result ? "Run again" : "Run the simulation"}</Button>
          <span className="text-xs text-muted">{changed.length || whatVol ? `What-if: ${[...changed.map(([k, v]) => `${model.resources.find((r) => r.key === k)?.label} ${v}`), whatVol ? `${whatVol} % patients` : ""].filter(Boolean).join(", ")}` : "To compare a change, type new numbers in the What-if column below, then run."}</span>
        </div>
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
            const have = res.key === "porter" ? porters : res.capacity;
            return [
              <tr key={res.key} className={`border-t border-line align-top ${r?.flag ? "bg-danger-soft/40" : ""}`}>
                <td className="px-3 py-1.5">{r ? <button type="button" onClick={() => setOpen(open === res.key ? null : res.key)} aria-expanded={open === res.key} className="text-left text-primary hover:underline">{res.label}</button> : res.label}
                  <span className="block text-[11px] text-muted">{KIND_LABEL[res.kind]}{have === 0 ? " · none found, so not limited" : ""}</span></td>
                <td className="px-2 text-right">{have}</td>
                <td className="px-2"><input aria-label={`What-if ${res.label}`} inputMode="numeric" className="h-8 w-16 rounded border border-line bg-surface px-2 text-sm" value={whatIf[res.key] ?? ""} placeholder={String(have)} onChange={(e) => setWhatIf({ ...whatIf, [res.key]: e.target.value.replace(/[^\d]/g, "") })} /></td>
                {r && <>
                  <td className={`px-2 text-right ${r.utilisation.mean > UTIL_FLAG ? "font-semibold text-danger" : ""}`}>{r.capacity ? <Range b={r.utilisation} fmt={pct} /> : "—"}</td>
                  <td className="px-2 text-right"><Range b={r.meanWait} fmt={fmtMinutes} /></td>
                  <td className={`px-2 text-right ${r.p90Wait.mean > WAIT_FLAG ? "font-semibold text-danger" : ""}`}><Range b={r.p90Wait} fmt={fmtMinutes} /></td>
                  <td className="px-2 text-right">{Math.round(r.maxQueue.mean)}</td>
                  <td className="px-2 text-right">{r.capacity ? hh(r.peakHour) : "—"}</td>
                </>}
                {x && <>
                  <td className={`px-2 text-right ${x.utilisation.mean > UTIL_FLAG ? "font-semibold text-danger" : "text-ok"}`}>{x.capacity ? <Range b={x.utilisation} fmt={pct} /> : "—"}</td>
                  <td className="px-2 text-right"><Range b={x.meanWait} fmt={fmtMinutes} /></td>
                </>}
              </tr>,
              open === res.key && r && (
                <tr key={`${res.key}-chart`} className="border-t border-line/50"><td colSpan={w ? 10 : 8} className="px-3 py-2">
                  <HourChart base={r.hourly} what={x?.hourly} queue={r.queueHourly} />
                  <p className="text-xs text-muted">Bars: share busy each hour of the day (red above {pct(UTIL_FLAG)}). Orange line: patients waiting{x ? "; green line: the what-if" : ""}. Hover a bar for the figures.</p>
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
            <tbody>{b.flows.map((f) => { const x = w?.flows.find((y) => y.id === f.id); return (
              <tr key={f.id} className="border-t border-line">
                <td className="px-3 py-1.5"><a href={`/flows/${f.id}`} className="text-primary hover:underline">{f.name}</a></td>
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
