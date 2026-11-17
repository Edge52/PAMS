"use client";
/** 3D view panel parts: simSection, pathwaysPanel (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import Link from "next/link";
import { formatDuration } from "../nav/route";
import { BED, CLEAR } from "../nav/clearance";
import { loadColor, simPlace } from "../sim-on-model";
import { fmtMinutes } from "@/lib/flows/simulate";
import { pathwayCard } from "../pathways";
import { hourRanges } from "@/lib/flows/analysis";
import { readiness, readinessLine } from "@/lib/flows/readiness";
import type { TwinCtx } from "../use-twin-view";

export function SimSection({ t }: { t: TwinCtx }) {
  const { assetList, checksBusy, data, focus, runSim, setSimOnModel, simBusy, simErr, simOnModel, simRes } = t;
  return <>{data.hasFlows ? (
    <div className="border-t border-[#123a55] pt-2">
      <p className="twin-h mb-1!">Queue simulation on the model</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runSim} disabled={!!simBusy} className="twin-act">{simBusy ? `Running… ${simBusy.done}/${simBusy.of}` : simRes ? "Run again" : "Simulate a week"}</button>
        {simRes && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={simOnModel} onChange={(e) => setSimOnModel(e.target.checked)} className="accent-[#2fd3ff]" />On the model</label>}
        <Link href={`/flows/simulate?facilityId=${data.facility.id}`} className="text-xs text-[#5fd6ff] hover:underline">Simulator</Link>
      </div>
      {simErr && <p className="mt-1 text-xs text-[#ff8a96]">{simErr}</p>}
      {checksBusy === "sim" && <p className="mt-1 text-xs text-[#8fb6cc]">Loading the pathways…</p>}
      {!simRes && !simBusy && checksBusy !== "sim" && <p className="mt-1 text-xs text-[#8fb6cc]">Ten runs of a week of the published pathways; rooms, scanners and lifts are coloured by how busy they are.</p>}
      {simRes && (
        <>
          <p className="mt-1 flex flex-wrap gap-x-2 text-[11px]">{([["#3ddc97", "under 60 % busy"], ["#ffd166", "60–85 %"], ["#ff5a6a", "over 85 % or long waits"]] as const).map(([c, t]) => <span key={c} className="flex items-center gap-1"><span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: c }} />{t}</span>)}</p>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs">
            {[...simRes.resources].filter((r) => r.capacity > 0 && r.kind !== "staff").sort((a, b) => Number(b.flag) - Number(a.flag) || b.utilisation.mean - a.utilisation.mean).slice(0, 25).map((r) => {
              const pl = simPlace(r.key, data.rooms, assetList.map((a) => ({ id: a.id, roomId: a.roomId, typeCode: a.typeCode })));
              return (
                <li key={r.key}><button type="button" className="w-full text-left hover:underline" onClick={() => { if (pl.rooms[0] != null) focus({ kind: "room", id: pl.rooms[0] }); }}>
                  <span aria-hidden className="mr-1.5 inline-block size-2 rounded-sm" style={{ background: loadColor(r.utilisation.mean) }} /><span className="text-white">{r.label}</span>
                  <span className={`block pl-3.5 ${r.flag ? "font-semibold text-[#ff8a96]" : "text-[#8fb6cc]"}`}>{Math.round(r.utilisation.mean * 100)} % busy · 1 in 10 waits {fmtMinutes(r.p90Wait.mean)} · peak {String(r.peakHour).padStart(2, "0")}:00</span>
                </button></li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  ) : null}</>;
}

export function PathwaysPanel({ t }: { t: TwinCtx }) {
  const { bedIssues, bedOn, card, cardFlow, cd, cdFlows, cdOn, data, floorId, flowBusy, flowColor, flowSel, flows, frameFlow, frameLeg, heat, heatOn, liftRows, placed, playSpeed, playing, ready7c, sceneRef, setBedOn, setCardFlow, setCdOn, setFloorId, setFlowSel, setHeatOn, setPlaySpeed, setPlaying, shownFlow, shownWithRoutes, statusOf, toggleFlow } = t;
  const simSection = <SimSection t={t} />;
  return <>{(
    <div className="space-y-2 text-sm">
      {!flows.length ? (
        <p className="text-xs text-[#8fb6cc]">No published pathways for this hospital yet. <Link href={`/flows?facilityId=${data.facility.id}`} className="text-[#5fd6ff] hover:underline">Set one up</Link> (starters for trauma, surgery, maternity and imaging), publish it, and it shows here.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {flows.map((f) => (
              <li key={f.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={flowSel.includes(f.id)} onChange={() => toggleFlow(f.id)} className="accent-[#2fd3ff]" />
                  <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: flowColor(f.id) }} />
                  <span className="min-w-0 truncate">{f.name}{f.status === "DRAFT" ? ` (v${f.version} draft)` : ""}</span>
                  {f.dailyVolume != null && <span className="ml-auto shrink-0 text-xs text-[#8fb6cc]">{f.dailyVolume}/day</span>}
                </label>
              </li>
            ))}
          </ul>
          {flowBusy && <p className="text-xs text-[#8fb6cc]">Working out routes…</p>}
          {flowSel.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[#123a55] pt-2">
              <button type="button" onClick={() => setPlaying((p) => !p)} disabled={flowBusy} aria-pressed={playing} className="twin-act">{playing ? "Stop" : "Play patients"}</button>
              <label className="flex items-center gap-1 text-xs text-[#8fb6cc]">Speed
                <select value={playSpeed} onChange={(e) => setPlaySpeed(Number(e.target.value))} className="twin-input w-auto! py-0.5">
                  {[10, 60, 300, 600].map((v) => <option key={v} value={v}>{v}×</option>)}
                </select>
              </label>
              <button type="button" onClick={() => frameFlow(cardFlow ?? flowSel[0])} className="twin-act">Fit to view</button>
            </div>
          )}
          {flowSel.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Pathway card">
              {flowSel.map((id) => (
                <button key={id} type="button" onClick={() => setCardFlow(id)} aria-pressed={shownFlow?.id === id}
                  className={`rounded border px-1.5 py-0.5 text-xs ${shownFlow?.id === id ? "border-[#2fd3ff] text-white" : "border-[#1d4f6d] text-[#8fb6cc]"}`}>
                  <span aria-hidden style={{ color: flowColor(id) }}>● </span>{flows.find((f) => f.id === id)?.name.split(/ [—-] /)[0]}
                </button>
              ))}
            </div>
          )}
          {shownFlow && card && (
            <div className="space-y-1.5 border-t border-[#123a55] pt-2">
              <p className="text-[13px] font-semibold text-white"><span aria-hidden style={{ color: flowColor(shownFlow.id) }}>● </span>{shownFlow.name} <span className="font-normal text-[#8fb6cc]">v{shownFlow.version}</span></p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-[#8fb6cc]">Walked per patient</dt><dd className="text-right text-white">{Math.round(card.metres)} m</dd>
                <dt className="text-[#8fb6cc]">Time moving</dt><dd className="text-right text-white">{formatDuration(card.moveSeconds)}</dd>
                <dt className="text-[#8fb6cc]">Time in care</dt><dd className="text-right text-white">{card.careMinutes >= 2880 ? `${(card.careMinutes / 1440).toFixed(1)} days` : card.careMinutes >= 120 ? `${Math.round(card.careMinutes / 60)} h` : `${Math.round(card.careMinutes)} min`}</dd>
                <dt className="text-[#8fb6cc]">Floor changes</dt><dd className="text-right text-white">{card.floorChanges.toFixed(1)}</dd>
                <dt className="text-[#8fb6cc]">Lift trips</dt><dd className="text-right text-white">{card.liftTrips.toFixed(1)}</dd>
              </dl>
              <p className="text-[11px] text-[#8fb6cc]">Averages per patient: each arrow counts by the share of patients taking it. Estimates; lift waits are assumptions.</p>
              {card.longest?.route && (
                <p className="text-xs text-[#ffd166]">Longest leg: {card.longest.from} → {card.longest.to}, {Math.round(card.longest.route.metres)} m{card.longest.route.floorChanges ? `, ${card.longest.route.floorChanges} floor${card.longest.route.floorChanges === 1 ? "" : "s"}` : ""}, {formatDuration(card.longest.route.seconds)}</p>
              )}
              {(card.estimated > 0 || card.unrouted > 0) && (
                <p className="text-xs text-[#ffb534]">{card.estimated > 0 ? `${card.estimated} leg${card.estimated === 1 ? "" : "s"} partly estimated (dashed)` : ""}{card.estimated && card.unrouted ? " · " : ""}{card.unrouted > 0 ? `${card.unrouted} not drawn (a step without a place)` : ""}</p>
              )}
              <ul className="space-y-0.5">
                {card.legs.map((l) => (
                  <li key={l.index}>
                    <button type="button" disabled={!l.route} onClick={() => l.route && frameLeg(l.route)}
                      className="w-full rounded px-1.5 py-0.5 text-left text-xs hover:bg-[#0c2a40] disabled:opacity-50">
                      <span className="text-white">{l.from} → {l.to}</span>
                      <span className="text-[#8fb6cc]">{l.share !== 100 ? ` · ${l.share} %` : ""}{l.route ? ` · ${Math.round(l.route.metres)} m · ${formatDuration(l.route.seconds)}` : " · no route"}{l.route?.estimated ? " · estimated" : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {ready7c && ready7c.total > 0 && (
                <div className="border-t border-[#123a55] pt-1.5">
                  <p className={`text-xs font-semibold ${ready7c.blocked ? "text-[#ff8a96]" : "text-[#3cf5a6]"}`}>
                    Equipment: {ready7c.blocked ? `${ready7c.total - ready7c.ok} of ${ready7c.total} needs not met` : `all ${ready7c.total} needs met`} (live)
                  </p>
                  <ul className="mt-0.5 space-y-0.5 text-[11px]">
                    {ready7c.rows.filter((r) => r.state !== "ok").map((r, i) => <li key={i} className="text-[#ff8a96]">{readinessLine(r)}</li>)}
                    {ready7c.noPlace.length > 0 && <li className="text-[#ffb534]">Not checked (no place): {ready7c.noPlace.join(", ")}</li>}
                  </ul>
                </div>
              )}
              <Link href={`/flows/${shownFlow.id}`} className="inline-block text-xs text-[#5fd6ff] hover:underline">Open the pathway</Link>
            </div>
          )}
          {shownWithRoutes.length >= 2 && (
            <div className="border-t border-[#123a55] pt-2">
              <p className="twin-h mb-1!">Compare</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr><th className="text-left font-normal text-[#8fb6cc]" />{shownWithRoutes.map(({ f }) => <th key={f.id} className="px-1 text-right font-semibold" style={{ color: flowColor(f.id) }}>{f.name.split(/ [—-] /)[0]} v{f.version}{f.status === "DRAFT" ? " (draft)" : ""}</th>)}</tr></thead>
                  <tbody>
                    {([
                      ["Walked", (c) => `${Math.round(c.metres)} m`],
                      ["Moving", (c) => formatDuration(c.moveSeconds)],
                      ["In care", (c) => (c.careMinutes >= 2880 ? `${(c.careMinutes / 1440).toFixed(1)} d` : c.careMinutes >= 120 ? `${Math.round(c.careMinutes / 60)} h` : `${Math.round(c.careMinutes)} min`)],
                      ["Floor changes", (c) => c.floorChanges.toFixed(1)],
                      ["Lift trips", (c) => c.liftTrips.toFixed(1)],
                      ["Longest leg", (c) => (c.longest?.route ? `${Math.round(c.longest.route.metres)} m` : "—")],
                    ] as [string, (c: ReturnType<typeof pathwayCard>) => string][]).map(([label, fmt]) => (
                      <tr key={label} className="border-t border-[#123a55]"><td className="py-0.5 text-[#8fb6cc]">{label}</td>{shownWithRoutes.map(({ f, rs }) => <td key={f.id} className="px-1 text-right text-white">{fmt(pathwayCard(f, rs))}</td>)}</tr>
                    ))}
                    <tr className="border-t border-[#123a55]"><td className="py-0.5 text-[#8fb6cc]">Equipment</td>{shownWithRoutes.map(({ f }) => {
                      const r = readiness(f.steps, data.rooms, placed.map((a) => ({ id: a.id, typeCode: a.typeCode, typeName: a.deviceType, roomId: a.roomId, status: a.status })), (a) => statusOf(a.id, a.status), f.names);
                      return <td key={f.id} className={`px-1 text-right ${r.blocked ? "text-[#ff8a96]" : "text-[#3cf5a6]"}`}>{r.total ? `${r.ok}/${r.total}` : "—"}</td>;
                    })}</tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-[#8fb6cc]">Per patient. To compare a draft with the published version, use “Show in 3D” on the draft.</p>
            </div>
          )}
          {cdFlows.some((f) => f.kind === "SUPPLIES") && cdFlows.some((f) => f.kind === "WASTE") && (
            <div className="border-t border-[#123a55] pt-2">
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={cdOn} className="mt-0.5 accent-[#2fd3ff]"
                onChange={(e) => { const on = e.target.checked; setCdOn(on); if (on) { setFlowSel((sel) => [...new Set([...sel, ...cdFlows.map((f) => f.id)])]); if (floorId != null) { setFloorId(null); sceneRef.current?.isolateFloor(null, false); } } }} />
                <span>Clean and dirty routes<span className="block text-xs text-[#8fb6cc]">Shows the clean supply and waste pathways and marks in red where they share a corridor.</span></span>
              </label>
              {cd && (
                <div className="mt-1 text-xs">
                  <p className={cd.shared.length ? "text-[#ff8a96]" : "text-[#7dffc0]"}>{cd.shared.length ? `${cd.shared.length * 2} m of corridor shared` : "No corridor shared"}{flowBusy ? " (still routing…)" : ""}</p>
                  {cd.lifts.map((l) => <p key={l.name} className={l.hours.length ? "text-[#ff8a96]" : "text-[#ffc46b]"}>{l.name}: used by both{l.hours.length ? `, at the same time ${hourRanges(l.hours)}` : ", at different hours"}</p>)}
                  {!cd.lifts.length && <p className="text-[#7dffc0]">No lift used by both.</p>}
                </div>
              )}
            </div>
          )}
          {simSection}
          {shownWithRoutes.length > 0 && (
            <div className="border-t border-[#123a55] pt-2">
              <p className="twin-h mb-1!">Load of these pathways</p>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={heatOn} onChange={(e) => setHeatOn(e.target.checked)} className="mt-0.5 accent-[#2fd3ff]" />
                <span>Corridor traffic<span className="block text-xs text-[#8fb6cc]">Patients a day along each 2 m of corridor, blue (few) to red (busiest){heat?.length ? `; busiest ${Math.round(Math.max(...heat.map((c) => c.perDay)) * 10) / 10} a day` : ""}.</span></span>
              </label>
              <label className="mt-1 flex items-start gap-2 text-sm"><input type="checkbox" checked={bedOn} onChange={(e) => setBedOn(e.target.checked)} className="mt-0.5 accent-[#2fd3ff]" />
                <span>Bed and stretcher clearance<span className="block text-xs text-[#8fb6cc]">On bed and trolley legs: points narrower than {CLEAR.bed} m, corridors under {CLEAR.passing} m, corners a {BED.length} m bed can&apos;t turn. Widths estimated from the walls.</span></span>
              </label>
              {bedOn && bedIssues && (bedIssues.length === 0 ? <p className="ml-6 text-xs text-[#b9ffe0]">No pinch points on these bed routes.</p> : (
                <ul className="ml-6 mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                  {bedIssues.slice(0, 30).map((b, i) => (
                    <li key={i}><button type="button" className="text-left hover:underline" onClick={() => { const s = sceneRef.current; if (!s) return; setFloorId(b.floorId); s.isolateFloor(b.floorId, false); s.frameSpots([{ floorId: b.floorId, x: b.x, z: b.z }]); }}>
                      <span aria-hidden className="mr-1 inline-block size-2 rounded-full" style={{ background: b.severity === "high" ? "#ff3b5c" : "#ffb020" }} /><span className="text-white">{b.text}</span> <span className="text-[#8fb6cc]">· {b.leg}</span></button></li>
                  ))}
                </ul>
              ))}
              {liftRows.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {liftRows.map((r) => (
                    <li key={r.lift} title={r.formula} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate text-white">{r.lift}</span>
                      <span className={r.flag ? "font-semibold text-[#ff8a96]" : "text-[#8fb6cc]"}>{r.peakTrips} trips at peak · {Math.round(r.utilisation * 100)} %</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-xs text-[#8fb6cc]">No lift trips on these pathways.</p>}
              <p className="mt-1 text-[11px] text-[#8fb6cc]">Lift load: busiest-hour trips × round trip ÷ car time (hover for the working). Flag above 70 %. Only these pathways are counted. <Link href={`/flows/analysis?facilityId=${data.facility.id}`} className="text-[#5fd6ff] hover:underline">Room, bed and scanner load</Link></p>
            </div>
          )}
        </>
      )}
    </div>
  )}</>;
}
