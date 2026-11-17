"use client";
/** 3D view panel parts: timePanel (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import { EVENT_COLORS, EVENT_LABELS } from "../timeline";
import type { TwinCtx } from "../use-twin-view";

export function TimePanel({ t }: { t: TwinCtx }) {
  const { assetById, focus, histo, histoMax, history, historyBusy, historyDays, loadHistory, replayDay, replayStatus, setHistory, setHistoryDays, setReplayStatus, setTimeAt, setTimeKinds, setTimePlaying, setTimeWindow, shownEvents, timeAt, timeKinds, timePlaying, timeWindow } = t;
  return <>{(
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={historyDays} onChange={(e) => setHistoryDays(Number(e.target.value))} aria-label="How far back" className="twin-input w-auto! py-0.5">
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <button type="button" onClick={() => void loadHistory(historyDays)} disabled={historyBusy} className="twin-act">{historyBusy ? "Loading…" : history ? "Reload" : "Load"}</button>
        {history && <button type="button" onClick={() => { setHistory(null); setTimePlaying(false); }} className="twin-act">Clear</button>}
      </div>
      {!history && <p className="text-xs text-[#8fb6cc]">Replay what happened: faults reported, repairs done, moves and installations, shown at each device, and each device&apos;s status on the day.</p>}
      {history && (
        <>
          <div className="flex h-8 items-end gap-px" aria-hidden>{histo.map((n, i) => <div key={i} className="flex-1 bg-[#2f6b8f]" style={{ height: `${Math.max(4, (n / histoMax) * 100)}%` }} />)}</div>
          <input type="range" min={history.since} max={history.until} step={3600_000} value={timeAt} onChange={(e) => { setTimeAt(Number(e.target.value)); setTimePlaying(false); }}
            aria-label="Time" aria-valuetext={new Date(timeAt).toLocaleString()} className="w-full accent-[#2fd3ff]" />
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button type="button" onClick={() => { if (timeAt >= history.until) setTimeAt(history.since); setTimePlaying((p) => !p); }} aria-pressed={timePlaying} className="twin-act">{timePlaying ? "Pause" : "Play"}</button>
            <span className="text-white">{new Date(timeAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            <select value={timeWindow} onChange={(e) => setTimeWindow(Number(e.target.value))} aria-label="Show events from the last" className="twin-input ml-auto w-auto! py-0.5">
              {[1, 3, 7].map((d) => <option key={d} value={d}>{d === 1 ? "Last day" : `Last ${d} days`}</option>)}
            </select>
          </div>
          <label className="flex items-start gap-1.5 text-xs">
            <input type="checkbox" checked={replayStatus} onChange={(e) => setReplayStatus(e.target.checked)} className="mt-0.5 accent-[#2fd3ff]" />
            <span><span className="text-white">Device status on {replayDay ? new Date(`${replayDay}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "that day"}</span>
              <span className="block text-[11px] text-[#8fb6cc]">{!history.status.length ? "No status history yet: it is recorded every hour from now on." : history.snapshotsSince
                ? `Recorded since ${new Date(`${history.snapshotsSince}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}; earlier days rebuilt from work orders' downtime.`
                : "Rebuilt from work orders' downtime; recorded from now on."}</span></span>
          </label>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {(["fault", "repair", "move", "install"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={timeKinds.has(k)} onChange={() => setTimeKinds((s0) => { const n = new Set(s0); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="accent-[#2fd3ff]" />
                <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: EVENT_COLORS[k] }} />{EVENT_LABELS[k]} {history.events.filter((e) => e.kind === k).length}
              </label>
            ))}
          </div>
          {shownEvents.length > 0 ? (
            <ul className="space-y-0.5 text-xs">
              {shownEvents.slice(0, 8).map((e, i) => {
                const a = assetById.get(e.assetId);
                return (
                  <li key={i}><button type="button" onClick={() => a && focus({ kind: "asset", id: a.id })} className="w-full rounded px-1 py-0.5 text-left hover:bg-[#0c2a40]">
                    <span style={{ color: EVENT_COLORS[e.kind] }}>●</span> <span className="text-white">{a ? `${a.deviceType} ${a.tag}` : "A device"}</span>
                    <span className="block text-[11px] text-[#8fb6cc]">{e.text} · {new Date(e.t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </button></li>
                );
              })}
              {shownEvents.length > 8 && <li className="text-[11px] text-[#8fb6cc]">and {shownEvents.length - 8} more in the model</li>}
            </ul>
          ) : <p className="text-xs text-[#8fb6cc]">Nothing in this window.</p>}
        </>
      )}
    </div>
  )}</>;
}
