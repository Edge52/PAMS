"use client";
/** 3D view panel parts: floorList, statusList, typeList, placeList (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import { formatDims } from "@/lib/assets/dimensions";
import { STATUS_COLORS, STATUS_LABELS } from "../types";
import type { TwinCtx } from "../use-twin-view";

export function FloorList({ t }: { t: TwinCtx }) {
  const { chooseFloor, floorId, perFloor, placed, sortedFloors } = t;
  return <>{(
    <div>
      <button type="button" onClick={() => chooseFloor(null)} aria-pressed={floorId == null} className="twin-floor">
        <span>Whole building</span><span>{placed.length}</span>
      </button>
      {sortedFloors.map((f) => (
        <button key={f.id} type="button" onClick={() => chooseFloor(f.id)} aria-pressed={floorId === f.id} className="twin-floor">
          <span>{f.name}</span><span>{perFloor.get(f.id) ?? 0}</span>
        </button>
      ))}
      <p className="mt-2 text-xs text-[#8fb6cc]">Choose a floor and zoom in to see room names and device shapes.</p>
    </div>
  )}</>;
}

export function StatusList({ t }: { t: TwinCtx }) {
  const { setStatuses, statusCounts, statuses, toggle, visibleStatuses } = t;
  return <>{(
    <div>
      {visibleStatuses.map((s) => (
        <button key={s} type="button" onClick={() => toggle(statuses, s, setStatuses)} aria-pressed={statuses.has(s)}
          className={`twin-chip ${statuses.size && !statuses.has(s) ? "opacity-40" : ""}`}>
          <span className="size-2.5 rounded-full" style={{ background: STATUS_COLORS[s], boxShadow: `0 0 8px ${STATUS_COLORS[s]}` }} />
          <span className="flex-1 text-left">{STATUS_LABELS[s]}</span><span className="text-[#8fb6cc]">{statusCounts.get(s)}</span>
        </button>
      ))}
      {statuses.size > 0 && <button type="button" onClick={() => setStatuses(new Set())} className="mt-1 text-xs text-[#5fd6ff] hover:underline">Show every status</button>}
    </div>
  )}</>;
}

export function TypeList({ t }: { t: TwinCtx }) {
  const { categories, cats, setCats, toggle } = t;
  return <>{(
    <div>
      {categories.map((c) => (
        <button key={c.code} type="button" onClick={() => toggle(cats, c.code, setCats)} aria-pressed={cats.has(c.code)}
          className={`twin-chip ${cats.size && !cats.has(c.code) ? "opacity-40" : ""}`}>
          <span className="flex-1 text-left">{c.name}</span><span className="text-[#8fb6cc]">{c.n}</span>
        </button>
      ))}
      {cats.size > 0 && <button type="button" onClick={() => setCats(new Set())} className="mt-1 text-xs text-[#5fd6ff] hover:underline">Show all types</button>}
    </div>
  )}</>;
}

export function PlaceList({ t }: { t: TwinCtx }) {
  const { data, dropping, floorId, placeFloor, placeFloors, ready, setPlaceFloor, startDrop, unplaced } = t;
  return <>{(
    <div className="space-y-2">
      <p className="text-xs text-[#8fb6cc]">Registered, not in a room yet. Pick one and drop it on the plan at its real size; R turns it, Esc cancels.</p>
      <label className="block text-xs text-[#8fb6cc]">Floor
        <select value={placeFloor ?? floorId ?? placeFloors.find((f) => f.hasCad)?.id ?? ""} onChange={(e) => setPlaceFloor(Number(e.target.value))} className="twin-input mt-1">
          {placeFloors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <ul className="space-y-1.5">
        {unplaced.slice(0, 100).map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-[#123a55] px-2 py-1.5">
            <span className="min-w-0">
              <span className="block truncate text-sm text-white">{a.deviceType}</span>
              <span className="block text-[11px] text-[#8fb6cc]">{a.tag} · {formatDims(a.dims)}</span>
            </span>
            {data.can.move && <button type="button" onClick={() => startDrop(a, placeFloor ?? floorId)} disabled={dropping != null || !ready} className="twin-act shrink-0">Place</button>}
          </li>
        ))}
      </ul>
      {unplaced.length > 100 && <p className="text-xs text-[#8fb6cc]">Showing 100 of {unplaced.length}. Use the asset register to find the rest.</p>}
      {!data.can.move && <p className="text-xs text-[#8fb6cc]">Placing needs permission to move assets.</p>}
    </div>
  )}</>;
}
