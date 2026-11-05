"use client";
/**
 * Commissioning in the 3D view (wave 14, C5): a week slider that colours each room of a commissioning plan by how
 * far it had got that week (or was planned to), with rooms behind the plan in red. Kept out of twin-view.tsx: the
 * view only asks for the room colours and places the panel.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { addDays, LATE_COLOR, STAGE_COLORS, STAGES, stageOn, type CommissioningPayload, type Dates } from "@/lib/assets/commissioning";

const dates = (d: (string | null)[]): Dates => ({ handover: d[0], installed: d[1], accepted: d[2] });
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function useCommissioning(plans: { id: number; name: string }[], initial: number | null) {
  const [planId, setPlanId] = useState<number | null>(initial != null && plans.some((p) => p.id === initial) ? initial : null);
  const [data, setData] = useState<CommissioningPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [mode, setMode] = useState<"actual" | "planned">("actual");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (planId == null) return;
    let stop = false;
    (async () => {
      try {
        const res = await fetch(`/assets/3d/commissioning?planId=${planId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const d = (await res.json()) as CommissioningPayload;
        if (!stop) { setData(d); setError(null); }
      } catch (e) { if (!stop) { setData(null); setError((e as Error).message || "The plan couldn't be loaded."); } }
    })();
    return () => { stop = true; };
  }, [planId]);

  const todayIdx = data ? Math.max(0, data.weeks.findLastIndex((w) => w <= data.today)) : 0;
  const idx = data ? Math.min(data.weeks.length - 1, week ?? todayIdx) : 0;

  useEffect(() => {
    if (!playing || !data) return;
    const t = setInterval(() => setWeek((w) => {
      const n = (w ?? todayIdx) + 1;
      if (n >= data.weeks.length) { setPlaying(false); return data.weeks.length - 1; }
      return n;
    }), 700);
    return () => clearInterval(t);
  }, [playing, data, todayIdx]);

  const view = useMemo(() => {
    if (!data) return null;
    const end = addDays(data.weeks[idx], 6);
    const asOf = end < data.today ? end : data.today;
    const tint = new Map<number, { color: string; level: number }>();
    const counts = [0, 0, 0, 0]; let late = 0;
    for (const [roomId, planned, actual] of data.rooms) {
      const ps = stageOn(dates(planned), mode === "planned" ? end : asOf), as = stageOn(dates(actual), asOf);
      const stage = mode === "planned" ? ps : as;
      const isLate = mode === "actual" && as < ps;
      counts[stage]++; if (isLate) late++;
      tint.set(roomId, { color: isLate ? LATE_COLOR : STAGE_COLORS[stage], level: stage });
    }
    return { tint, counts, late, end, future: data.weeks[idx] > data.today };
  }, [data, idx, mode]);

  const choose = (id: number | null) => { setData(null); setError(null); setWeek(null); setPlaying(false); setPlanId(id); };

  const panel = (
    <div>
      <label className="block text-xs text-[#8fb6cc]" htmlFor="twin-commissioning">Plan</label>
      <select id="twin-commissioning" className="twin-input mt-1" value={planId ?? ""} onChange={(e) => choose(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Off</option>
        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {error && <p role="alert" className="mt-1 text-xs text-[#ff8a96]">{error}</p>}
      {planId != null && !data && !error && <p className="mt-1 text-xs text-[#8fb6cc]">Loading…</p>}
      {data && view && (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[13px] text-white">Week of {short(data.weeks[idx])}</span>
            {view.future && mode === "actual" && <span className="text-[11px] text-[#8fb6cc]">future: as of today</span>}
          </div>
          <input type="range" min={0} max={data.weeks.length - 1} value={idx} onChange={(e) => { setPlaying(false); setWeek(Number(e.target.value)); }}
            aria-label="Week" aria-valuetext={`Week of ${short(data.weeks[idx])}`} className="mt-1 w-full accent-[#2fd3ff]" />
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button type="button" className="twin-act" onClick={() => { if (!playing && idx >= data.weeks.length - 1) setWeek(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</button>
            <button type="button" className="twin-act" onClick={() => { setPlaying(false); setWeek(null); }}>This week</button>
          </div>
          <fieldset className="mt-2 flex gap-3 text-[13px]">
            <legend className="sr-only">Show</legend>
            {(["actual", "planned"] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5"><input type="radio" name="twin-comm-mode" checked={mode === m} onChange={() => setMode(m)} className="accent-[#2fd3ff]" />{m === "actual" ? "What happened" : "The plan"}</label>
            ))}
          </fieldset>
          <ul className="mt-2 space-y-1 text-[13px]" aria-label="Commissioning legend">
            {STAGES.map((s, i) => <li key={s} className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: STAGE_COLORS[i] }} /><span className="flex-1">{s}</span><span className="text-[#8fb6cc]">{view.counts[i]}</span></li>)}
            {mode === "actual" && <li className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: LATE_COLOR }} /><span className="flex-1">Behind the plan</span><span className="text-[#8fb6cc]">{view.late}</span></li>}
          </ul>
          <p className="mt-2 text-xs text-[#8fb6cc]">Rooms of the plan only; the rest stay dark. <Link href={`/assets/commissioning/${data.id}`} className="text-[#5fd6ff] hover:underline">Open the plan</Link></p>
        </>
      )}
    </div>
  );

  const summary = !data || !view ? (planId != null ? "Loading" : "Off") : `${short(data.weeks[idx])}${playing ? " · playing" : ""}`;
  return { tint: view?.tint ?? null, panel, summary, on: planId != null };
}
