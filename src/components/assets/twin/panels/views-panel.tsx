"use client";
/** 3D view panel parts: presetCard, viewsPanel (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import { decodeView, describeView } from "../view-state";
import { STATUS_COLORS, STATUS_LABELS } from "../types";
import { LAYER_INFO } from "../layers";
import { type RenderSettings } from "../render/render-panel";
import type { TwinCtx } from "../use-twin-view";

export function PresetCard({ t }: { t: TwinCtx }) {
  const { choosePreset, focus, presetInfo, roomById } = t;
  return <>{presetInfo && (
    <section className="mb-2 rounded-md border px-2 py-1.5" style={{ borderColor: presetInfo.p.color }} aria-label={`${presetInfo.p.label} summary`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-white">{presetInfo.p.label}</p>
        <button type="button" onClick={() => choosePreset(null)} className="text-xs text-[#8fb6cc] hover:text-white">Clear</button>
      </div>
      <p className="text-xs text-[#d6f3ff]">{presetInfo.summary.rooms} room{presetInfo.summary.rooms === 1 ? "" : "s"} on {presetInfo.summary.floors.length} floor{presetInfo.summary.floors.length === 1 ? "" : "s"} · {presetInfo.summary.devices.toLocaleString()} device{presetInfo.summary.devices === 1 ? "" : "s"}</p>
      {presetInfo.summary.statuses.length > 0 && (
        <p className="mt-0.5 text-[11px]">{presetInfo.summary.statuses.map((x, i) => <span key={x.status}>{i ? " · " : ""}<span style={{ color: STATUS_COLORS[x.status] ?? "#8fb6cc" }}>{x.n} {(STATUS_LABELS[x.status] ?? x.status).toLowerCase()}</span></span>)}</p>
      )}
      {presetInfo.summary.categories.length > 0 && <p className="mt-0.5 text-[11px] text-[#8fb6cc]">{presetInfo.summary.categories.slice(0, 4).map((c) => `${c.name} ${c.n}`).join(" · ")}</p>}
      {presetInfo.summary.troubleRooms.length > 0 && (
        <div className="mt-1">
          <p className="text-[11px] text-[#ffb534]">Rooms with a device down:</p>
          <ul className="text-[12px]">{presetInfo.summary.troubleRooms.slice(0, 6).map((id) => { const r = roomById.get(id); return r ? <li key={id}><button type="button" onClick={() => focus({ kind: "room", id })} className="text-left text-[#5fd6ff] hover:underline">{r.name} · {r.code}</button></li> : null; })}</ul>
        </div>
      )}
      <p className="mt-1 text-[11px] text-[#8fb6cc]">Rooms by department type, room type or name. Esc clears.</p>
    </section>
  )}</>;
}

export function ViewsPanel({ t }: { t: TwinCtx }) {
  const { applyView, canManageViews, copyLink, downloadImage, floorById, saveView, setRenderInit, setRenderOpen, shareLink, snapping, viewAction, viewPending, viewState, views } = t;
  const presetCard = <PresetCard t={t} />;
  return <>{(
    <div>
      {presetCard}
      {views.length === 0 ? <p className="text-xs text-[#8fb6cc]">No saved views yet. Set up the model, then save it with a name.</p> : (
        <ul className="space-y-0.5">
          {views.map((v) => {
            const st = decodeView(v.state);
            return (
              <li key={v.id} className="flex items-center gap-1">
                <button type="button" onClick={() => st && applyView(st)} disabled={!st} className="min-w-0 flex-1 rounded px-1.5 py-1 text-left text-[13px] hover:bg-[#0c2a40]">
                  <span className="block truncate text-white">{v.name}</span>
                  <span className="block truncate text-[11px] text-[#8fb6cc]">{v.shared ? `Shared${v.by && !v.mine ? ` by ${v.by}` : ""}` : "Only you"}{st ? ` · ${describeView(st, st.floor != null ? floorById.get(st.floor)?.name ?? null : null, LAYER_INFO[st.layer].label)}` : ""}</span>
                </button>
                {v.render && <button type="button" onClick={() => { if (st) applyView(st); setRenderInit(v.render as RenderSettings); setRenderOpen(true); }} className="twin-act px-1.5! py-0.5! text-xs" title="Open the presentation render with this view's settings">Render</button>}
                {(v.mine || canManageViews) && (
                  <form action={viewAction}>
                    <input type="hidden" name="op" value="delete" /><input type="hidden" name="viewId" value={v.id} />
                    <button type="submit" className="px-1 text-xs text-[#8fb6cc] hover:text-[#ff8a96]" aria-label={`Delete view ${v.name}`}>✕</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={saveView} className="mt-2 space-y-1.5">
        <label className="sr-only" htmlFor="twin-view-name">Name for this view</label>
        <input id="twin-view-name" name="name" required maxLength={80} placeholder="Name this view, e.g. 4th floor ICUs" className="twin-input" />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[#8fb6cc]"><input type="checkbox" name="shared" className="accent-[#2fd3ff]" /> Share with the team</label>
          <button type="submit" disabled={viewPending} className="twin-act">Save view</button>
        </div>
        {viewState?.error && <p role="alert" className="text-xs text-[#ff8a96]">{viewState.error}</p>}
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[#123a55] pt-2">
        <button type="button" onClick={copyLink} className="twin-act">Copy link</button>
        <button type="button" onClick={downloadImage} disabled={snapping} className="twin-act">{snapping ? "Making image…" : "Download image"}</button>
        <button type="button" onClick={() => setRenderOpen(true)} className="twin-act" title="Furnished presentation image or floor book">Presentation render…</button>
      </div>
      {shareLink && <input readOnly value={shareLink} onFocus={(e) => e.currentTarget.select()} aria-label="Link to this view" className="twin-input mt-2 text-xs" />}
    </div>
  )}</>;
}
