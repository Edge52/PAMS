"use client";
/** 3D view panel parts: detailsBody (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import Link from "next/link";
import { setWorkshopAction } from "@/app/assets/3d/actions";
import { STATUS_COLORS, STATUS_LABELS } from "../types";
import { formatDuration } from "../nav/route";
import { JobRibbon } from "../job-ribbon";
import { FitPanel } from "../fit-panel";
import { TEMPLATE_COLORS, TEMPLATE_WORDS, templateKind } from "../twin-view-parts";
import type { TwinCtx } from "../use-twin-view";
import { NotesBlock } from "./notes";

export function DetailsBody({ t }: { t: TwinCtx }) {
  const { assetById, checks, clearRoute, clearSpot, data, deptById, dropping, findNearest, floorById, focus, live, liveAt, moveAction, movePending, moveState, nearest, placeExactly, placingId, roomAssets, roomById, roomsByFloor, routeTo, sceneRef, selAsset, selRoom, selected, setOutlines, setToast, setWorkshops, setZone, showRouteTo, startDrop, statusOf, typeNames, workshops, zones } = t;
  const notesBlock = <NotesBlock t={t} />;
  return <>{(
    <>
      {selAsset && (
        <div className="space-y-1.5 text-sm">
          <p className="text-base font-semibold text-white">{selAsset.deviceType}</p>
          <p className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: STATUS_COLORS[statusOf(selAsset.id, selAsset.status)] }} />{STATUS_LABELS[statusOf(selAsset.id, selAsset.status)] ?? selAsset.status}</p>
          {(() => {
            const m = live.get(selAsset.id); if (!m) return null;
            const flags = [m.openJobs ? `${m.openJobs} open job${m.openJobs === 1 ? "" : "s"}` : null, m.overduePpm ? "maintenance overdue" : null,
              m.beyondLife ? "past service life" : null, m.recall ? "open recall" : null].filter(Boolean);
            return flags.length ? <p className="text-[13px] text-[#ffb08a]">{flags.join(" · ")}</p> : null;
          })()}
          <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-[13px]">
            <dt className="text-[#8fb6cc]">Tag</dt><dd className="break-all font-mono">{selAsset.tag}</dd>
            <dt className="text-[#8fb6cc]">Make</dt><dd>{[selAsset.manufacturer, selAsset.model].filter(Boolean).join(" ") || "—"}</dd>
            <dt className="text-[#8fb6cc]">Serial</dt><dd className="break-all font-mono">{selAsset.serial ?? "—"}</dd>
            <dt className="text-[#8fb6cc]">Criticality</dt><dd>{selAsset.criticality?.replace("_", " ").toLowerCase() ?? "—"}</dd>
          </dl>
          {(() => {
            const e = selAsset.lib ? data.library?.[selAsset.lib] : undefined; if (!e) return null;
            return (
              <div className="mt-1 border-t border-[#123a55] pt-1.5 text-[12px]">
                <p className="font-semibold text-[#5fd6ff]">Equipment library{e.glb ? " · own 3D model" : ""}{e.custom ? "" : " · typical figures"}</p>
                {e.zones.length > 0 && <p className="text-[#cfe6f3]">Clear: {e.zones.map((z) => `${z.name.toLowerCase()} ${z.depth} m${z.side === "all" ? " all round" : ` at the ${z.side}`}`).join(", ")}</p>}
                {e.fringe && <p className="text-[#ffb3b3]">Fringe field (0.5 mT): {e.fringe.along} × {e.fringe.across} m from the centre</p>}
                {e.connections.length > 0 && <p className="text-[#8fb6cc]">Connects: {e.connections.map((c) => c.label.toLowerCase()).join(", ")}</p>}
              </div>
            );
          })()}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Link href={`/assets/${selAsset.id}`} className="rounded-md bg-[#2fd3ff] px-3 py-1.5 text-sm font-semibold text-[#03121f] hover:bg-white">Open asset record</Link>
            {data.can.report && <Link href={`/assets/work-orders/new?assetId=${selAsset.id}`} className="twin-act text-[#ffb08a]">Report a fault</Link>}
            {data.can.maintain && <Link href={`/assets/${selAsset.id}#record-maintenance`} className="twin-act">Record maintenance</Link>}
            {(live.get(selAsset.id)?.openJobs ?? 0) > 0 && <Link href={`/assets/work-orders?tab=all&q=${encodeURIComponent(selAsset.tag)}`} className="twin-act">Open jobs</Link>}
          </div>
          <JobRibbon assetId={selAsset.id} refreshKey={`${liveAt}-${live.get(selAsset.id)?.openJobs ?? 0}`} />
          {data.can.move && (
            <div className="mt-3 space-y-2 border-t border-[#123a55] pt-2">
              <details>
                <summary className="cursor-pointer text-[13px] font-semibold text-[#5fd6ff]">Move to another room</summary>
                <form action={moveAction} className="mt-2 space-y-2">
                  <input type="hidden" name="assetId" value={selAsset.id} />
                  <label className="block text-xs text-[#8fb6cc]">Room
                    <select name="roomId" required defaultValue="" className="twin-input mt-1">
                      <option value="" disabled>Choose a room…</option>
                      {roomsByFloor.map(([f, rs]) => (
                        <optgroup key={f.id} label={f.name}>
                          {rs.map((r) => <option key={r.id} value={r.id} disabled={r.id === selAsset.roomId}>{r.name} · {r.code}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-[#8fb6cc]">Reason (optional)<input name="reason" maxLength={500} className="twin-input mt-1" /></label>
                  <button type="submit" disabled={movePending} className="twin-act">{movePending ? "Moving…" : "Move device"}</button>
                  {moveState?.error && <p role="alert" className="text-xs text-[#ff8a96]">{moveState.error}</p>}
                </form>
              </details>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.can.move && <button type="button" onClick={() => startDrop(selAsset, null)} disabled={dropping != null || placingId != null} className="twin-act" title="Pick it up and drop it anywhere at real size; R turns it. On a floor shown on its own you can also press and hold the device, then drag it.">Move on plan</button>}
                <button type="button" onClick={() => placeExactly(selAsset.id)} disabled={placingId != null} className="twin-act">Set exact spot</button>
                {selAsset.posX != null && <button type="button" onClick={() => clearSpot(selAsset.id)} className="twin-act">Use automatic spot</button>}
              </div>
              <p className="text-xs text-[#8fb6cc]">{selAsset.posX != null ? "Placed at its exact spot (also on the 2D floor map)." : "Placed automatically inside its room."}</p>
            </div>
          )}
        </div>
      )}
      {selRoom && (
        <div className={`text-sm ${selAsset ? "mt-4 border-t border-[#123a55] pt-3" : ""}`}>
          <p className="font-semibold text-white">{selRoom.name}</p>
          <p className="text-[#8fb6cc]">{selRoom.code} · {floorById.get(selRoom.floorId)?.name}{selRoom.departmentId ? ` · ${deptById.get(selRoom.departmentId)?.name}` : ""}</p>
          {selected?.kind === "room" && (
            roomAssets.length === 0 ? <p className="mt-2 text-[#8fb6cc]">No equipment registered in this room.</p> : (
              <ul className="mt-2 space-y-1">
                {roomAssets.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => focus({ kind: "asset", id: a.id })} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[#0c2a40]">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLORS[statusOf(a.id, a.status)] }} />
                      <span className="flex-1">{a.deviceType}</span><span className="font-mono text-xs text-[#8fb6cc]">{a.tag.split("-").pop()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
          <div className="mt-3 border-t border-[#123a55] pt-2">
            <label className="block text-[13px] font-semibold text-[#5fd6ff]" htmlFor="twin-nearest">Nearest working device from here</label>
            <select id="twin-nearest" className="twin-input mt-1" value={nearest?.fromRoomId === selRoom.id ? nearest.type : ""}
              onChange={(e) => findNearest(selRoom.id, e.target.value)}>
              <option value="">Choose a device type…</option>
              {typeNames.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {nearest?.fromRoomId === selRoom.id && (
              nearest.results.length === 0 ? <p className="mt-1 text-xs text-[#ff8a96]">No working {nearest.type.toLowerCase()} in this hospital right now.</p> : (
                <ul className="mt-1 space-y-0.5" aria-label="Nearest devices">
                  {nearest.results.map((r) => {
                    const a = assetById.get(r.id)!; const room = roomById.get(a.roomId!);
                    return (
                      <li key={r.id}>
                        <button type="button" onClick={() => showRouteTo(r)} aria-pressed={routeTo === r.id}
                          className={`w-full rounded px-1.5 py-1 text-left text-[13px] hover:bg-[#0c2a40] ${routeTo === r.id ? "bg-[#0c2a40] ring-1 ring-[#2fd3ff]" : ""}`}>
                          <span className="flex justify-between gap-2"><span className="truncate text-white">{room?.name ?? "Room"}</span><span className="shrink-0 text-[#5fd6ff]">{r.route && !r.route.estimated ? `${Math.round(r.route.metres)} m · ${formatDuration(r.route.seconds)}` : `≈ ${Math.round(r.distance)} m`}</span></span>
                          <span className="block text-[11px] text-[#8fb6cc]">{a.tag} · {r.sameFloor ? "same floor" : `${r.floors} floor${r.floors === 1 ? "" : "s"} ${(floorById.get(room!.floorId)?.elevation ?? 0) > (floorById.get(selRoom.floorId)?.elevation ?? 0) ? "up" : "down"}${r.route ? (r.route.legs.find((l) => l.kind !== "walk")?.via ? ` by ${r.route.legs.find((l) => l.kind !== "walk")!.via}` : "") : r.via ? ` by the ${r.via.kind === "lift" ? (r.via.name ?? "lift") : "stairs"}` : ""}`}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
            {routeTo != null && (
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={() => focus({ kind: "asset", id: routeTo })} className="twin-act">Open that device</button>
                <button type="button" onClick={clearRoute} className="twin-act">Clear route</button>
              </div>
            )}
          </div>
          {notesBlock}
          {!selAsset && (() => {
            const z = zones.has(selRoom.id) ? zones.get(selRoom.id) : selRoom.zone ?? null;
            return (
              <div className="mt-3 border-t border-[#123a55] pt-2 text-[13px]">
                <label className="flex items-center gap-2"><span className="font-semibold text-[#5fd6ff]">Access zone</span>
                  {data.can.editFacility || (selRoom.departmentId != null && data.can.zoneDepartments?.includes(selRoom.departmentId)) ? (
                    <select value={z ?? ""} onChange={(e) => void setZone(selRoom.id, e.target.value)} className="twin-input w-auto! py-0.5">
                      <option value="">From the name</option>
                      {(["PUBLIC", "PATIENT", "STAFF", "STERILE", "ISOLATION"] as const).map((k) => <option key={k} value={k}>{k.charAt(0) + k.slice(1).toLowerCase()}</option>)}
                    </select>
                  ) : <span className="text-white">{z ? z.charAt(0) + z.slice(1).toLowerCase() : "From the name"}</span>}
                </label>
                <p className="mt-0.5 text-[11px] text-[#8fb6cc]">Sterile and isolation rooms are closed to through-traffic: routes only start or end in them.</p>
                {data.can.editFacility ? (
                  <label className="mt-1.5 flex items-center gap-2"><input type="checkbox" checked={workshops.has(selRoom.id)} className="accent-[#2fd3ff]"
                    onChange={async (e) => {
                      const on = e.target.checked; const fd = new FormData(); fd.set("roomId", String(selRoom.id)); fd.set("on", on ? "1" : "0");
                      const res = await setWorkshopAction(null, fd);
                      if (res?.roomId) setWorkshops((w) => { const n = new Set(w); if (on) n.add(selRoom.id); else n.delete(selRoom.id); return n; });
                      setToast(res ? { ok: res.ok, error: res.error } : null);
                    }} />Biomedical workshop<span className="text-[11px] text-[#8fb6cc]">(work orders show the route from here)</span></label>
                ) : workshops.has(selRoom.id) ? <p className="mt-1 text-[11px] text-[#b9ffe0]">Biomedical workshop</p> : null}
              </div>
            );
          })()}
          {!selAsset && checks.templates?.get(selRoom.id) && (() => {
            const t = checks.templates!.get(selRoom.id)!, k = templateKind(t);
            return (
              <div className="mt-3 border-t border-[#123a55] pt-2 text-[13px]">
                <p><span className="font-semibold text-[#5fd6ff]">Room template</span>{" "}
                  <a href={`/facilities/room-standards/${t.index}?facilityId=${data.facility.id}`} className="text-white hover:underline">{t.label}</a>{" "}
                  <span className="ml-1 inline-flex items-center gap-1 text-[11px]"><span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: TEMPLATE_COLORS[k] }} />{TEMPLATE_WORDS[k]}</span></p>
                {t.short.length > 0 && <p className="mt-0.5 text-[12px] text-[#ffb3b3]">Short: {t.short.join("; ")}</p>}
                {t.missing.length > 0 && <p className="mt-0.5 text-[12px] text-[#ffd0a0]">Equipment missing: {t.missing.join("; ")}</p>}
                {t.unknown.length > 0 && <p className="mt-0.5 text-[11px] text-[#8fb6cc]">Not surveyed: {t.unknown.slice(0, 6).join(", ")}{t.unknown.length > 6 ? "…" : ""}</p>}
              </div>
            );
          })()}
          {!selAsset && floorById.get(selRoom.floorId) && (
            <FitPanel key={selRoom.id} room={selRoom} floor={floorById.get(selRoom.floorId)!} floorRooms={data.rooms.filter((r) => r.floorId === selRoom.floorId)}
              models={data.siteModels ?? []} canEdit={!!data.can.editFacility} facilityId={data.facility.id} onOverlay={setOutlines}
              onToast={(t) => setToast(t)}
              pickPoint={(done) => { const sc = sceneRef.current; if (!sc) return; sc.isolateFloor(selRoom.floorId, false); setToast({ ok: "Click where the equipment's centre goes." }); sc.pickPoint((p) => done(p)); }} />
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href={`/assets?roomId=${selRoom.id}`} className="text-sm text-[#5fd6ff] hover:underline">Room in the asset register</Link>
            <Link href={`/facilities/${data.facility.id}/rooms/${selRoom.id}/sheet`} className="text-sm text-[#5fd6ff] hover:underline">Room data sheet</Link>
            {data.can.addAsset && <Link href={`/assets/new?roomId=${selRoom.id}`} className="text-sm text-[#5fd6ff] hover:underline">Add a device here</Link>}
          </div>
        </div>
      )}
    </>
  )}</>;
}
