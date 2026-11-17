"use client";
/** 3D view panel parts: layerPanel (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import { colorFor, LAYER_INFO, LAYERS, NEUTRAL } from "../layers";
import type { TwinCtx } from "../use-twin-view";

export function LayerPanel({ t }: { t: TwinCtx }) {
  const { focus, heatMode, layer, legend, scope, setHeatMode, setLayer, setScope, worst } = t;
  return <>{(
    <div>
      <div role="radiogroup" aria-label="Colour rooms by">
        {LAYERS.map((l) => (
          <label key={l} className="twin-chip cursor-pointer">
            <input type="radio" name="twin-layer" value={l} checked={layer === l} onChange={() => setLayer(l)} className="accent-[#2fd3ff]" />
            <span className="flex-1 text-left">{LAYER_INFO[l].label}</span>
          </label>
        ))}
      </div>
      {layer !== "department" && (
        <>
          <div className="mt-2 flex gap-1 text-xs" role="group" aria-label="Group by">
            {(["room", "department"] as const).map((sc) => (
              <button key={sc} type="button" aria-pressed={scope === sc} onClick={() => setScope(sc)}
                className={`flex-1 rounded-md border px-2 py-1 ${scope === sc ? "border-[#2fd3ff] bg-[#0c2a40] text-white" : "border-[#1d4f6d] text-[#8fb6cc]"}`}>
                By {sc}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1 text-xs" role="group" aria-label="Show as">
            {(["smooth", "blocks"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={heatMode === m} onClick={() => setHeatMode(m)}
                className={`flex-1 rounded-md border px-2 py-1 ${heatMode === m ? "border-[#2fd3ff] bg-[#0c2a40] text-white" : "border-[#1d4f6d] text-[#8fb6cc]"}`}>
                {m === "smooth" ? "Heat map" : "Blocks"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[#8fb6cc]">{scope === "department" ? LAYER_INFO[layer].help.replace("each room", "each department") : LAYER_INFO[layer].help} {heatMode === "blocks" ? "Taller blocks mean more." : "Stronger colour means more."}</p>
          {legend && (
            <ul className="mt-2 space-y-1 text-[13px]" aria-label="Legend">
              {legend.labels.map((lab, i) => (
                <li key={lab} className="flex items-center gap-2">
                  <span className="size-3 rounded-sm" style={{ background: legend.colors[i], boxShadow: `0 0 6px ${legend.colors[i]}` }} />
                  <span className="flex-1">{lab}</span><span className="text-[#8fb6cc]">{legend.counts[i]}</span>
                </li>
              ))}
              <li className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: NEUTRAL }} /><span className="flex-1 text-[#8fb6cc]">None</span></li>
            </ul>
          )}
          {worst.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-[#8fb6cc]">Most affected</p>
              {worst.map((w) => (
                <button key={w.id} type="button" onClick={() => focus({ kind: "room", id: w.roomId })} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] hover:bg-[#0c2a40]">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(w.v, legend) ?? NEUTRAL }} />
                  <span className="min-w-0 flex-1 truncate">{w.name}</span><span className="text-[#8fb6cc]">{LAYER_INFO[layer].unit(w.v)}</span>
                </button>
              ))}
            </div>
          ) : <p className="mt-2 text-[13px] text-[#3cf5a6]">Nothing to show — no room is affected.</p>}
        </>
      )}
    </div>
  )}</>;
}
