"use client";
/** 3D view panel parts: toursPanel (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import { decodeView } from "../view-state";
import type { TwinCtx } from "../use-twin-view";

export function ToursPanel({ t }: { t: TwinCtx }) {
  const { addStop, applyView, canManageViews, data, deleteTour, floorById, playTour, recordTour, recording, saveTour, setShareLink, setToast, setTourEdit, stopsOk, tourEdit, tourPlay, tours } = t;
  return <>{(
    <div className="space-y-2 text-sm">
      {!tourEdit && (
        <>
          {tours.length === 0 ? <p className="text-xs text-[#8fb6cc]">No tours yet. A tour plays saved views one after another, with a caption for each: for a board meeting or a walk-through of a new wing.</p> : (
            <ul className="space-y-1">
              {tours.map((t) => (
                <li key={t.id} className="rounded border border-[#123a55] px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-white">{t.name}</span>
                    <button type="button" onClick={() => playTour(t)} className="twin-act">Play</button>
                    <button type="button" onClick={() => recordTour(t)} disabled={recording || !!tourPlay} className="twin-act" title="Plays the tour and saves it as a video (MP4 where the browser can, else WebM)">{recording ? "Recording…" : "Video"}</button>
                  </div>
                  <p className="text-[11px] text-[#8fb6cc]">{t.stops.length} stop{t.stops.length === 1 ? "" : "s"} · {Math.round(t.stops.reduce((a, x) => a + x.seconds, 0) / 6) / 10} min{t.shared ? " · shared" : ""}{!t.mine && t.by ? ` · by ${t.by}` : ""}</p>
                  <div className="mt-0.5 flex gap-3 text-[11px]">
                    <button type="button" onClick={async () => { const link = `${window.location.origin}/assets/3d?facilityId=${data.facility.id}&tour=${t.id}`; try { await navigator.clipboard.writeText(link); setToast({ ok: t.shared ? "Link to this tour copied." : "Link copied. Share the tour so others can open it." }); } catch { setShareLink(link); } }} className="text-[#5fd6ff] hover:underline">Copy link</button>
                    {(t.mine || canManageViews) && <button type="button" onClick={() => setTourEdit({ id: t.id, name: t.name, shared: t.shared, stops: t.stops })} className="text-[#5fd6ff] hover:underline">Edit</button>}
                    {(t.mine || canManageViews) && <button type="button" onClick={() => void deleteTour(t)} className="text-[#8fb6cc] hover:text-[#ff8a96]">Delete</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setTourEdit({ name: "", shared: false, stops: [] })} className="twin-act">New tour</button>
        </>
      )}
      {tourEdit && (
        <div className="space-y-2">
          <input value={tourEdit.name} onChange={(e) => setTourEdit({ ...tourEdit, name: e.target.value })} maxLength={80} placeholder="Tour name, e.g. New ICU wing" aria-label="Tour name" className="twin-input" />
          <ol className="space-y-1.5">
            {tourEdit.stops.map((st, i) => (
              <li key={i} className="rounded border border-[#123a55] p-1.5">
                <div className="flex items-center gap-1 text-[11px] text-[#8fb6cc]">
                  <span className="flex-1">Stop {i + 1}{(() => { const v = decodeView(st.state); return v ? ` · ${v.floor != null ? floorById.get(v.floor)?.name ?? "" : "Whole building"}` : ""; })()}</span>
                  <button type="button" onClick={() => { const v = decodeView(st.state); if (v) applyView(v); }} className="hover:text-white">Show</button>
                  <button type="button" disabled={i === 0} onClick={() => setTourEdit({ ...tourEdit, stops: tourEdit.stops.map((x, j) => (j === i - 1 ? tourEdit.stops[i] : j === i ? tourEdit.stops[i - 1] : x)) })} className="px-1 hover:text-white disabled:opacity-40" aria-label="Move up">↑</button>
                  <button type="button" disabled={i === tourEdit.stops.length - 1} onClick={() => setTourEdit({ ...tourEdit, stops: tourEdit.stops.map((x, j) => (j === i + 1 ? tourEdit.stops[i] : j === i ? tourEdit.stops[i + 1] : x)) })} className="px-1 hover:text-white disabled:opacity-40" aria-label="Move down">↓</button>
                  <button type="button" onClick={() => setTourEdit({ ...tourEdit, stops: tourEdit.stops.filter((_, j) => j !== i) })} className="hover:text-[#ff8a96]" aria-label="Remove stop">✕</button>
                </div>
                <input value={st.caption} onChange={(e) => setTourEdit({ ...tourEdit, stops: tourEdit.stops.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) })} maxLength={400} placeholder="Caption" aria-label={`Caption for stop ${i + 1}`} className="twin-input mt-1 text-xs" />
                <label className="mt-1 flex items-center gap-1 text-[11px] text-[#8fb6cc]">Seconds
                  <input type="number" min={2} max={120} value={st.seconds} onChange={(e) => setTourEdit({ ...tourEdit, stops: tourEdit.stops.map((x, j) => (j === i ? { ...x, seconds: Math.max(2, Math.min(120, Number(e.target.value) || 8)) } : x)) })} className="twin-input w-16! py-0.5" />
                </label>
              </li>
            ))}
          </ol>
          <button type="button" onClick={addStop} className="twin-act">Add this view as a stop</button>
          <label className="flex items-center gap-2 text-xs text-[#8fb6cc]"><input type="checkbox" checked={tourEdit.shared} onChange={(e) => setTourEdit({ ...tourEdit, shared: e.target.checked })} className="accent-[#2fd3ff]" />Share with the team</label>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void saveTour()} disabled={!stopsOk} className="twin-act">Save tour</button>
            <button type="button" onClick={() => setTourEdit(null)} className="twin-act">Cancel</button>
          </div>
          <p className="text-[11px] text-[#8fb6cc]">Set up the model (floor, camera, layer, filters), then add it as a stop. Playing: ← → step, Space pauses, Esc ends.</p>
        </div>
      )}
    </div>
  )}</>;
}
