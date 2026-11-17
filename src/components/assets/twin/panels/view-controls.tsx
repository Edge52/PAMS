"use client";
/** 3D view panel parts: viewControls (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import Link from "next/link";
import { CLASH_LABELS } from "@/lib/assets/clash";
import { CONN_COLORS, CONN_KINDS, CONN_LABELS, ZONE_COLORS, ZONE_KINDS, ZONE_LABELS } from "@/lib/assets/equipment-library";
import { CORE_LABELS } from "../geometry";
import { CONFIDENCE_COLORS, CONFIDENCE_WORDS, CORE_SWATCH, TEMPLATE_COLORS, TEMPLATE_WORDS } from "../twin-view-parts";
import type { TwinCtx } from "../use-twin-view";

export function ViewControls({ t }: { t: TwinCtx }) {
  const { assetById, basements, bloom, checks, checksBusy, clashOn, confidenceTint, coreCounts, cores, data, detailedModels, explode, facade, floorId, focus, furniture, groupH, hasBasements, libOverlay, roomColour, sceneRef, sectionAt, sectionAxis, setBasements, setBloom, setClashOn, setCores, setDetailedModels, setExplode, setFacade, setFloorId, setFurniture, setLibOverlay, setRoomColour, setSectionAt, setSectionAxis, setSolid, setSolidFloors, setStyle, solid, solidFloors, startWalk, stopWalk, style, templateTint, walking } = t;
  return <>{(
    <div>
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Look">
        {(["dark", "light"] as const).map((st) => (
          <button key={st} type="button" aria-pressed={style === st} onClick={() => setStyle(st)}
            className={`flex-1 rounded-md border px-2 py-1 ${style === st ? "border-[#2fd3ff] bg-[#0c2a40] text-white" : "border-[#1d4f6d] text-[#8fb6cc]"}`}>
            {st === "dark" ? "Digital twin" : "Architectural"}
          </button>
        ))}
      </div>
      <p className={groupH}>Model</p>
      <div className="space-y-1 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={detailedModels} onChange={(e) => setDetailedModels(e.target.checked)} className="accent-[#2fd3ff]" />Detailed equipment close up</label>
        <label className="flex items-start gap-1.5"><input type="checkbox" checked={furniture} onChange={(e) => setFurniture(e.target.checked)} className="mt-0.5 accent-[#2fd3ff]" />
          <span>Furniture on a floor shown on its own<span className="block text-[11px] text-[#8fb6cc]">Where the drawing shows it; elsewhere illustrative room kits by room type.</span></span></label>
      </div>
      <label className="mt-1 flex items-center gap-1.5 text-xs" title="On the floor shown on its own: walls stand floor to slab, with door and window openings; surveyed ceilings show as orange outlines"><input type="checkbox" checked={solid} onChange={(e) => setSolid(e.target.checked)} className="accent-[#2fd3ff]" /> Solid walls (one floor)</label>
      <label className="mt-1 flex items-center gap-1.5 text-xs" title="Every floor drawn as a built slab with solid room floors, so you can't see the floors below through it"><input type="checkbox" checked={solidFloors} onChange={(e) => setSolidFloors(e.target.checked)} className="accent-[#2fd3ff]" /> Solid floors (not see-through)</label>

      <p className={groupH}>Colour rooms by</p>
      <div className="space-y-1 text-xs" role="radiogroup" aria-label="Colour rooms by">
        <label className="flex items-center gap-1.5"><input type="radio" name="twin-room-colour" checked={roomColour === "layer"} onChange={() => setRoomColour("layer")} className="accent-[#2fd3ff]" />Departments or the problem layer</label>
        <label className="flex items-start gap-1.5"><input type="radio" name="twin-room-colour" checked={roomColour === "confidence"} onChange={() => setRoomColour("confidence")} className="mt-0.5 accent-[#2fd3ff]" />
          <span>Drawing confidence
            {confidenceTint && <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">{(["assumed", "fallback", "verified"] as const).map((k) => <span key={k} className="flex items-center gap-1"><span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: CONFIDENCE_COLORS[k] }} />{CONFIDENCE_WORDS[k]}</span>)}</span>}
            {confidenceTint && <span className="block text-[11px] text-[#8fb6cc]"><a href={`/facilities/${data.facility.id}/drawing-quality`} className="text-[#5fd6ff] hover:underline">Drawing quality</a> lists the issues floor by floor.</span>}</span></label>
        <label className="flex items-start gap-1.5"><input type="radio" name="twin-room-colour" checked={roomColour === "templates"} onChange={() => setRoomColour("templates")} className="mt-0.5 accent-[#2fd3ff]" />
          <span>Room templates
            {templateTint && <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">{(["short", "missing", "unknown", "ok"] as const).map((k) => <span key={k} className="flex items-center gap-1"><span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: TEMPLATE_COLORS[k] }} />{TEMPLATE_WORDS[k]}</span>)}</span>}
            {templateTint && <span className="block text-[11px] text-[#8fb6cc]">Each room against the <Link href="/facilities/room-standards" className="text-[#5fd6ff] hover:underline">template</Link> for its kind.</span>}</span></label>
      </div>
      <p className={groupH}>Checks</p>
      <div className="mb-3 space-y-1 text-xs">
        <label className="flex items-start gap-1.5"><input type="checkbox" checked={libOverlay} onChange={(e) => setLibOverlay(e.target.checked)} className="mt-0.5 accent-[#2fd3ff]" />
          <span>Clearance zones and connections
            {libOverlay && <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">{ZONE_KINDS.map((k) => <span key={k} className="flex items-center gap-1"><span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: ZONE_COLORS[k] }} />{ZONE_LABELS[k]}</span>)}
              {CONN_KINDS.map((k) => <span key={k} className="flex items-center gap-1"><span aria-hidden className="inline-block size-2 rounded-full" style={{ background: CONN_COLORS[k] }} />{CONN_LABELS[k]}</span>)}</span>}
            <span className="block text-[11px] text-[#8fb6cc]">On a floor shown on its own, or the selected device&apos;s floor, from the <Link href="/catalogue/library" className="text-[#5fd6ff] hover:underline">equipment library</Link>.</span></span></label>
        <label className="flex items-start gap-1.5"><input type="checkbox" checked={clashOn} onChange={(e) => setClashOn(e.target.checked)} className="mt-0.5 accent-[#2fd3ff]" />
          <span>Clash check{checksBusy === "clashes" ? <span className="text-[#8fb6cc]"> · checking…</span> : checks.clashes ? <span className="text-[#8fb6cc]"> · {checks.clashes.length} issue{checks.clashes.length === 1 ? "" : "s"}</span> : null}
            <span className="block text-[11px] text-[#8fb6cc]">Out of their room, on top of each other, clear zones blocked, in a door, in an MRI field, too tall, rooms too full. <Link href={`/facilities/${data.facility.id}/clashes`} className="text-[#5fd6ff] hover:underline">Full list</Link></span></span></label>
        {clashOn && (checks.clashes?.length ?? 0) > 0 && (() => {
          const list = (checks.clashes ?? []).filter((c) => floorId == null || c.floorId === floorId);
          return (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto pl-5 text-[12px]">
              {list.length === 0 ? <li className="text-[#8fb6cc]">None on this floor.</li> : list.slice(0, 40).map((c, i) => {
                const a = assetById.get(c.deviceId);
                return (
                  <li key={i}><button type="button" onClick={() => focus({ kind: "asset", id: c.deviceId })} className="text-left hover:underline">
                    <span aria-hidden className="mr-1 inline-block size-2 rounded-full" style={{ background: c.severity === "high" ? "#ff3b5c" : "#ffb020" }} />
                    <span className="text-white">{a ? `${a.deviceType} ${a.tag}` : `Device ${c.deviceId}`}</span> <span className="text-[#8fb6cc]">{CLASH_LABELS[c.kind].toLowerCase()}: {c.text}</span></button></li>
                );
              })}
              {list.length > 40 && <li className="text-[#8fb6cc]">and {list.length - 40} more</li>}
            </ul>
          );
        })()}
      </div>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <button type="button" onClick={walking ? stopWalk : () => void startWalk()} aria-pressed={walking} className="twin-act" title="First person on the floor shown, kept to the walkable space (W)">{walking ? "Stop walking" : "Walk this floor"}</button>
        {floorId == null && !walking && <span className="text-[#8fb6cc]">Choose a floor first</span>}
      </div>
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Camera">
        {([["iso", "Isometric"], ["plan", "Plan"], ["eye", "Eye level"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { const f = sceneRef.current?.viewPreset(k); if (k === "eye" && f != null) setFloorId(f); }}
            className="flex-1 rounded-md border border-[#1d4f6d] px-2 py-1 text-[#d6f3ff] hover:border-[#2fd3ff]">{label}</button>
        ))}
      </div>
      <label className="flex items-center justify-between text-[13px]" htmlFor="twin-explode">Floor spacing <span className="text-[#8fb6cc]">{explode.toFixed(1)}×</span></label>
      <input id="twin-explode" type="range" min={1} max={4} step={0.1} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-full accent-[#2fd3ff]" />
      <details className="mt-2">
        <summary className="cursor-pointer text-[13px] text-[#5fd6ff]">More view options</summary>
      {style === "dark" && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} className="accent-[#2fd3ff]" /> Glow</label>}
      {hasBasements && <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={basements} onChange={(e) => setBasements(e.target.checked)} className="accent-[#2fd3ff]" /> Basements in the whole building</label>}
      <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={facade} onChange={(e) => setFacade(e.target.checked)} className="accent-[#2fd3ff]" /> Glass façade (from afar)</label>
      <div className="mt-3 border-t border-[#123a55] pt-2">
        <label className="flex items-center justify-between gap-2 text-[13px]" htmlFor="twin-section">Section cut
          <select id="twin-section" value={sectionAxis} onChange={(e) => setSectionAxis(e.target.value as "" | "x" | "z")} className="twin-input w-auto py-0.5 text-xs">
            <option value="">Off</option><option value="x">East–west</option><option value="z">North–south</option>
          </select>
        </label>
        {sectionAxis && <input type="range" min={0} max={1} step={0.01} value={sectionAt} onChange={(e) => setSectionAt(Number(e.target.value))} aria-label="Where to cut" className="mt-1 w-full accent-[#2fd3ff]" />}
      </div>
      {coreCounts && coreCounts.stair + coreCounts.lift + coreCounts.shaft > 0 && (
        <>
          <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={cores} onChange={(e) => setCores(e.target.checked)} className="accent-[#2fd3ff]" /> Lifts and stairs</label>
          {cores && (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[#8fb6cc]" aria-label="Lifts and stairs legend">
              {(["stair", "lift", "shaft"] as const).filter((k) => coreCounts[k]).map((k) => (
                <li key={k} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: CORE_SWATCH[k] }} />{CORE_LABELS[k]} {coreCounts[k]}</li>
              ))}
            </ul>
          )}
        </>
      )}
      </details>
    </div>
  )}</>;
}
