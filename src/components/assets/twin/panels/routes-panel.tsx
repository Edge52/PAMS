"use client";
/** 3D view panel parts: routesPanel (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import { formatDuration } from "../nav/route";
import type { TwinCtx } from "../use-twin-view";

export function RoutesPanel({ t }: { t: TwinCtx }) {
  const { clearTrauma, data, fixMode, fixes, floorById, floorId, focus, navInfo, navOn, ready, removeFix, roomById, sceneRef, setFixMode, setNavInfo, setNavOn, showTrauma, startFix, trauma, unreachable } = t;
  return <>{(
    <div className="space-y-2 text-sm">
      <label className="flex items-start gap-2"><input type="checkbox" checked={navOn} onChange={(e) => { setNavOn(e.target.checked); setNavInfo(null); }} className="mt-0.5 accent-[#2fd3ff]" />
        <span>Walking network<span className="block text-xs text-[#8fb6cc]">On the floor shown: walkable area (green), rooms closed to through-traffic (amber), assumed doors (yellow), unreachable rooms (red).</span></span>
      </label>
      {navOn && floorId == null && <p className="text-xs text-[#ffb534]">Choose a floor to see its network.</p>}
      {navOn && floorId != null && <p className="text-xs text-[#b9ffe0]">{navInfo ?? "Building the network…"}</p>}
      {navOn && floorId != null && unreachable.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[#ffb534]">Rooms routes can&apos;t reach ({unreachable.length})</summary>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">{unreachable.map((id) => <li key={id}><button type="button" onClick={() => focus({ kind: "room", id })} className="text-left text-[#d6f3ff] hover:underline">{roomById.get(id)?.name ?? `Room ${id}`}</button></li>)}</ul>
          {data.can.editFacility && <p className="mt-1 text-[11px] text-[#8fb6cc]">Open a gap into the room where its door is (Add an opening).</p>}
        </details>
      )}
      {navOn && floorId != null && data.can.editFacility && (
        <div className="space-y-1.5 border-t border-[#123a55] pt-2">
          <p className="text-xs text-[#8fb6cc]">Fix the network where the drawing is wrong. Fixes are kept by position, so they survive rebuilding and drawing updates.</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => startFix("OPEN")} disabled={fixMode != null} className="twin-act">Add an opening</button>
            <button type="button" onClick={() => startFix("CLOSE")} disabled={fixMode != null} className="twin-act">Close a gap</button>
            {fixMode && <button type="button" onClick={() => { sceneRef.current?.cancelPickPoint(); setFixMode(null); }} className="twin-act">Cancel</button>}
          </div>
          {fixMode && <p className="text-xs text-[#ffc46b]">{fixMode.a ? "Now click the other end." : fixMode.kind === "OPEN" ? "Click one side of the wall where the door is…" : "Click one end of the gap to close…"}</p>}
          {fixes.filter((f) => f.floorId === floorId).length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {fixes.filter((f) => f.floorId === floorId).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2">
                  <span className="text-[#d6f3ff]">{f.kind === "OPEN" ? "Opening" : "Closed gap"} · {Math.round(Math.hypot(f.x2 - f.x1, f.y2 - f.y1) / (floorById.get(f.floorId)?.unitsPerMetre || 10) * 10) / 10} m{f.by ? ` · ${f.by}` : ""}</span>
                  <button type="button" onClick={() => void removeFix(f)} className="text-[#8fb6cc] hover:text-[#ff8a96]">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="border-t border-[#123a55] pt-2">
        <p className="text-xs text-[#8fb6cc]">Early look at patient pathways: a trauma patient by bed from the ambulance entrance to Resus, CT and the ICU.</p>
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" onClick={showTrauma} disabled={trauma?.busy || !ready} className="twin-act">{trauma?.busy ? "Routing…" : "Show trauma route"}</button>
          {trauma && !trauma.busy && <button type="button" onClick={clearTrauma} className="twin-act">Clear</button>}
        </div>
        {trauma?.error && <p role="alert" className="mt-1.5 text-xs text-[#ff8a96]">{trauma.error}</p>}
        {trauma?.steps && trauma.total && (
          <div className="mt-2 space-y-1">
            {trauma.steps.map((st, i) => (
              <div key={i} className="rounded border border-[#123a55] px-2 py-1">
                <p className="text-[13px] text-white">{st.from} → {st.to}</p>
                <p className="text-[11px] text-[#8fb6cc]">{Math.round(st.route.metres)} m · {formatDuration(st.route.seconds)}
                  {st.route.legs.filter((l) => l.kind !== "walk").map((l) => ` · ${l.via}`).join("")}{st.route.estimated ? " · estimated (part not on the network)" : ""}</p>
              </div>
            ))}
            <p className="text-[13px] font-semibold text-[#b9ffe0]">Total {Math.round(trauma.total.metres)} m · {formatDuration(trauma.total.seconds)} by bed · {trauma.total.liftTrips} lift trip{trauma.total.liftTrips === 1 ? "" : "s"}</p>
            <p className="text-[11px] text-[#8fb6cc]">Bed pace 0.6 m/s; lift waits are assumptions until measured. Bed journeys use bed lifts only.</p>
          </div>
        )}
      </div>
    </div>
  )}</>;
}
