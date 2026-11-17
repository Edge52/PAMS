"use client";
/** 3D view panel parts: findBox (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import type { TwinCtx } from "../use-twin-view";

export function FindBox({ t }: { t: TwinCtx }) {
  const { floorById, focus, matches, query, roomById, roomMatches, setQuery } = t;
  return <>{(
    <div>
      <label htmlFor="twin-search" className="sr-only">Find a device or room</label>
      <input id="twin-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ventilator, DGH-MON-000042, ICU…"
        className="w-full rounded-md border border-[#1d4f6d] bg-[#04121f] px-2.5 py-1.5 text-sm text-white placeholder:text-[#4f7187] focus:border-[#2fd3ff] focus:outline-none" />
      {query.trim().length >= 2 && (
        <div className="mt-2 max-h-48 overflow-y-auto text-sm" aria-live="polite">
          {roomMatches.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-xs text-[#8fb6cc]">Rooms</p>
              {roomMatches.map((r) => (
                <button key={`r${r.id}`} type="button" onClick={() => focus({ kind: "room", id: r.id })} className="block w-full rounded px-1.5 py-1 text-left hover:bg-[#0c2a40]">
                  <span className="text-white">{r.name}</span> <span className="text-xs text-[#8fb6cc]">{r.code} · {floorById.get(r.floorId)?.name}</span>
                </button>
              ))}
            </div>
          )}
          {matches.length === 0 ? (roomMatches.length ? null : <p className="text-[#8fb6cc]">Nothing matches “{query}”.</p>) : (
            <>
              <p className="mb-1 text-xs text-[#8fb6cc]">{matches.length === 200 ? "200+" : matches.length} found, highlighted in the model</p>
              {matches.slice(0, 50).map((a) => (
                <button key={a.id} type="button" onClick={() => focus({ kind: "asset", id: a.id })} className="block w-full rounded px-1.5 py-1 text-left hover:bg-[#0c2a40]">
                  <span className="text-white">{a.deviceType}</span>
                  <span className="block text-xs text-[#8fb6cc]">{a.tag} · {roomById.get(a.roomId!)?.name} · {floorById.get(roomById.get(a.roomId!)!.floorId)?.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )}</>;
}
