"use client";

import Link from "next/link";
import { saveViewAction } from "@/app/assets/3d/actions";
import { formatDims } from "@/lib/assets/dimensions";
import { encodeView } from "./view-state";
import { HudRail } from "./hud";
import { HudMap } from "./hud-map";
import { HudCompass } from "./hud-compass";
import { northFor } from "@/lib/assets/north";
import { LAYER_INFO } from "./layers";
import { RenderPanel } from "./render/render-panel";
import { PRESETS } from "./presets";
import { SHORTCUTS } from "./timeline";

import { WalkStick } from "./twin-view-parts";


/**
 * Hospital digital twin: interactive 3D building with every tracked device in its room.
 * The scene itself lives in ./scene (three.js); this component is the HUD around it.
 * HUD layout follows the view's own width (see hud-state): side columns of collapsible panels (folded by default
 * below 1100 px), or on phones one bottom sheet with tabs.
 */
import { useTwinView, type TwinCtx } from "./use-twin-view";
import { FloorList, StatusList, PlaceList, TypeList } from "./panels/lists";
import { LayerPanel } from "./panels/layer-panel";
import { PlanPanel } from "./panels/plan-panel";
import { ViewControls } from "./panels/view-controls";
import { RoutesPanel } from "./panels/routes-panel";
import { PathwaysPanel } from "./panels/pathways-panel";
import { TimePanel } from "./panels/time-panel";
import { FindBox } from "./panels/find-box";
import { NotesPanel } from "./panels/notes";
import { ToursPanel } from "./panels/tours-panel";
import { ViewsPanel } from "./panels/views-panel";
import { DetailsBody } from "./panels/details";

export function TwinView(props: Parameters<typeof useTwinView>[0]) {
  const t: TwinCtx = useTwinView(props);
  const { assetList, categories, cats, choosePreset, closeDetails, comm, commissioning, compact, currentView, data, dropping, error, explode, filterCount, floorId, floorName, flowSel, flows, hasSelection, helpOpen, history, host, hover, hoverCard, isFull, layer, liveError, liveTime, matches, menu, navOn, notes, onTabKey, panels, panelsHidden, phone, placed, placingId, plan, planSummary, plans, playing, presentation, preset, progress, query, ready, renderInit, renderOpen, roomById, root, router, sceneRef, selAsset, setHelpOpen, setLook, setMenu, setPanelsHidden, setRenderInit, setRenderOpen, setSheetTab, setToast, setTourPlay, setViews, sheetTab, shownEvents, solidFloors, statuses, stopTour, stopWalk, style, tabs, toast, toggleFull, tourPlay, tourStop, tours, trauma, turnOf, undo, unplaced, views, visibleStatuses, walking } = t;
  const floorList = <FloorList t={t} />;
  const layerPanel = <LayerPanel t={t} />;
  const planPanel = <PlanPanel t={t} />;
  const viewControls = <ViewControls t={t} />;
  const routesPanel = <RoutesPanel t={t} />;
  const pathwaysPanel = <PathwaysPanel t={t} />;
  const timePanel = <TimePanel t={t} />;
  const statusList = <StatusList t={t} />;
  const placeList = <PlaceList t={t} />;
  const findBox = <FindBox t={t} />;
  const notesPanel = <NotesPanel t={t} />;
  const toursPanel = <ToursPanel t={t} />;
  const viewsPanel = <ViewsPanel t={t} />;
  const typeList = <TypeList t={t} />;
  const detailsBody = <DetailsBody t={t} />;
  return (
    <div ref={root} className={`twin relative -mx-5 -mb-3 -mt-6 h-[calc(100dvh-4rem)] overflow-hidden ${style === "light" ? "bg-[#e8edf1]" : "bg-[#030a14]"} text-[#d6f3ff] md:-mx-8 lg:-mx-10`}>
      <div ref={host} className="absolute inset-0" aria-label="3D model of the hospital with its equipment" role="img" />

      {/* Top bar */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 pl-16 md:pl-4 ${phone ? "p-3" : "p-4"}`}>
        <div className={`pointer-events-auto min-w-0 ${style === "light" ? "-mx-3 -my-1.5 rounded-lg bg-[#04121fd9] px-3 py-1.5 backdrop-blur" : ""}`}>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#5fd6ff]">Digital twin</p>
          <h1 className={`${phone ? "text-base" : "text-xl"} font-bold text-white`}>{data.facility.name}</h1>
          <p className="text-xs text-[#8fb6cc] sm:text-sm">{data.floors.length} floors · {data.rooms.length.toLocaleString()} rooms · {placed.length.toLocaleString()} devices</p>
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {data.facilities.length > 1 && (
            <select aria-label="Facility" value={data.facility.id} onChange={(e) => router.push(`/assets/3d?facilityId=${e.target.value}`)}
              className="twin-ctl max-w-[12rem]">
              {data.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <span className="flex items-center gap-1" role="group" aria-label="Show a service">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => choosePreset(preset === p.id ? null : p.id)} aria-pressed={preset === p.id}
                className="twin-ctl" style={preset === p.id ? { borderColor: p.color, color: "#fff", boxShadow: `inset 0 -2px 0 ${p.color}` } : undefined}
                title={`Show the ${p.label.toLowerCase()} rooms and their equipment across the hospital`}>{p.label}</button>
            ))}
          </span>
          <span className="twin-ctl flex items-center gap-1.5" role="status" title={liveError ? "Couldn't refresh; retrying every minute" : "Statuses refresh every minute"}>
            <span className={`size-2 rounded-full ${liveError ? "bg-[#ff4f62]" : "bg-[#3cf5a6] motion-safe:animate-pulse"}`} />
            {liveError ? "Offline" : "Live"} · {liveTime}
          </span>
          <Link href="/assets/map" className="twin-ctl">2D map</Link>
          <span className="flex items-center gap-1" role="group" aria-label="Look">
            <button type="button" onClick={() => setLook("presentation")} aria-pressed={presentation} className="twin-ctl" style={presentation ? { borderColor: "#d4b483", color: "#fff", boxShadow: "inset 0 -2px 0 #d4b483" } : undefined}
              title="Light, with built floors and no glow: the look for showing the hospital">Presentation</button>
            <button type="button" onClick={() => setLook("technical")} aria-pressed={style === "dark" && !solidFloors} className="twin-ctl" style={style === "dark" && !solidFloors ? { borderColor: "#2fd3ff", color: "#fff", boxShadow: "inset 0 -2px 0 #2fd3ff" } : undefined}
              title="The glowing see-through model: the look for working in it">Technical</button>
          </span>
          {!phone && <button type="button" onClick={() => setPanelsHidden((f) => !f)} aria-pressed={panelsHidden} className="twin-ctl" title="Hide the side panels to see the whole model">{panelsHidden ? "Show panels" : "Hide panels"}</button>}
          <button type="button" onClick={toggleFull} aria-pressed={isFull} className="twin-ctl" title="Fill the screen with the 3D view (Esc to leave)">{isFull ? "Leave full screen" : "Full screen"}</button>
          <button type="button" onClick={() => sceneRef.current?.frameAll()} className="twin-ctl">Reset view</button>
          <button type="button" onClick={() => setHelpOpen((o) => !o)} aria-expanded={helpOpen} className="twin-ctl" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
        </div>
      </div>

      {!phone && !panelsHidden && (
        <>
          {/* Wave 22b: a tool rail on each side with one tool open at a time. The columns let clicks through to the model. */}
          <HudRail side="left" isOpen={panels.isOpen} onToggle={panels.toggle} panelWidth={compact ? "13rem" : "15rem"} className={`bottom-40 left-4 ${compact ? "top-32" : "top-28"}`}
            tools={[
              { id: "floors", label: "Floors", title: "Floors", summary: floorName, body: floorList },
              { id: "layers", label: "Layers", title: "Problem layer", summary: LAYER_INFO[layer].label, body: layerPanel },
              ...(plans.length > 0 ? [{ id: "plan" as const, label: "Plan", title: "Plan vs installed", summary: plan ? `${Math.round((planSummary!.installed / Math.max(1, planSummary!.planned)) * 100)} %` : "Off", body: planPanel }] : []),
              ...((commissioning?.plans.length ?? 0) > 0 ? [{ id: "commissioning" as const, label: "Opening", title: "Commissioning", summary: comm.summary, body: comm.panel, forceOpen: comm.on }] : []),
              { id: "view", label: "View", title: "View", summary: `${style === "dark" ? "Technical" : "Light"} · ${explode.toFixed(1)}×`, body: viewControls },
              { id: "routes", label: "Routes", title: "Routes", summary: navOn ? "Network on" : trauma?.total ? "Trauma route" : undefined, body: routesPanel },
              { id: "pathways", label: "Pathways", title: "Pathways", summary: flowSel.length ? `${flowSel.length} shown${playing ? " · playing" : ""}` : flows.length ? `${flows.length}` : "None", body: pathwaysPanel },
              { id: "history", label: "History", title: "History", summary: history ? `${shownEvents.length} shown` : "Off", body: timePanel },
              { id: "status", label: "Status", title: "Status", summary: statuses.size ? `${statuses.size} of ${visibleStatuses.length}` : "All", body: statusList },
            ]} />
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col items-start gap-2">
            <HudCompass scene={sceneRef} ready={ready} northDeg={northFor(data.floors, floorId)} light={style === "light"} />
            <HudMap scene={sceneRef} ready={ready} floors={data.floors} rooms={data.rooms} light={style === "light"} />
          </div>

          <HudRail side="right" isOpen={panels.isOpen} onToggle={panels.toggle} panelWidth={compact ? "16rem" : "20rem"} className={`bottom-4 right-4 ${compact ? "top-32" : "top-28"}`}
            tools={[
              ...(unplaced.length > 0 ? [{ id: "place" as const, label: "To place", title: "To place", summary: `${unplaced.length}`, body: placeList }] : []),
              { id: "find", label: "Find", title: "Find a device or room", summary: query.trim().length >= 2 ? `${matches.length === 200 ? "200+" : matches.length} found` : undefined, body: findBox },
              { id: "notes", label: "Notes", title: "Notes", summary: `${notes.filter((n) => n.status === "OPEN").length} open`, body: notesPanel },
              { id: "tours", label: "Tours", title: "Tours", summary: tours.length ? `${tours.length}` : undefined, body: toursPanel },
              { id: "views", label: "Views", title: "Views", summary: views.length ? `${views.length} saved` : undefined, body: viewsPanel },
              { id: "types", label: "Types", title: "Equipment types", summary: cats.size ? `${cats.size} of ${categories.length}` : `${categories.length}`, body: typeList },
            ]}>
            {hasSelection && (
              <section className="twin-card pointer-events-auto min-h-0 shrink overflow-y-auto" aria-label={selAsset ? "Selected device" : "Selected room"}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="twin-h">{selAsset ? "Device" : "Room"}</h2>
                  <button type="button" onClick={closeDetails} className="text-xs text-[#8fb6cc] hover:text-white" aria-label="Close details">Close</button>
                </div>
                {detailsBody}
              </section>
            )}
          </HudRail>
        </>
      )}

      {menu && (
        /* Wave 22b: right-click on a device or room. The same actions as the selection card, where the pointer is. */
        // Reads the view's size to keep the menu on screen, as before the wave 30 split (the rule now sees the ref).
        // eslint-disable-next-line react-hooks/refs
        <div role="menu" aria-label={menu.title} className="twin-card absolute z-30 w-56 p-1.5!" style={{ left: Math.min(menu.x, (root.current?.clientWidth ?? 9999) - 236), top: Math.min(menu.y, (root.current?.clientHeight ?? 9999) - 250) }}
          onKeyDown={(e) => { if (e.key === "Escape") setMenu(null); }}>
          <p className="truncate px-2 pb-1 pt-0.5 text-[11px] text-[#8fb6cc]">{menu.title}</p>
          {menu.items.map((it) => it.href
            ? <Link key={it.label} role="menuitem" href={it.href} className="flex min-h-9 items-center rounded-[8px] px-2 text-sm text-white hover:bg-[#0c2a40]">{it.label}</Link>
            : <button key={it.label} role="menuitem" type="button" onClick={() => { it.run?.(); setMenu(null); }} className="flex min-h-9 w-full items-center rounded-[8px] px-2 text-left text-sm text-white hover:bg-[#0c2a40]">{it.label}</button>)}
        </div>
      )}

      {phone && (
        /* Phone: one bottom sheet with tabs; tapping the open tab again folds it. */
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-2xl border-t border-[#123a55] bg-[#04121fee] backdrop-blur">
          <div className="flex items-center gap-1 px-2 pt-2" role="tablist" aria-label="3D view panels">
            {tabs.map((t, i) => {
              const active = sheetTab === t.id;
              return (
                <button key={t.id} id={`twin-tab-${t.id}`} type="button" role="tab" aria-selected={active} aria-controls="twin-sheet"
                  tabIndex={active || (!sheetTab && i === 0) ? 0 : -1} onKeyDown={(e) => onTabKey(e, i)}
                  onClick={() => setSheetTab(active ? null : t.id)}
                  className={`flex-1 rounded-md px-2 py-2 text-sm font-semibold ${active ? "bg-[#0c2a40] text-white shadow-[inset_0_-2px_0_#2fd3ff]" : "text-[#8fb6cc]"}`}>
                  {t.label}{t.badge && <span className="ml-1 rounded-full bg-[#2fd3ff] px-1.5 text-[11px] text-[#03121f]">{t.badge}</span>}
                </button>
              );
            })}
            <button type="button" onClick={() => setSheetTab(sheetTab ? null : "floors")} aria-expanded={!!sheetTab} aria-controls="twin-sheet"
              className="shrink-0 rounded-md px-2 py-2 text-sm text-[#8fb6cc]" aria-label={sheetTab ? "Fold the panel" : "Open the panel"}>
              <span aria-hidden className={`inline-block transition-transform motion-reduce:transition-none ${sheetTab ? "rotate-180" : ""}`}>▲</span>
            </button>
          </div>
          {!sheetTab && <p className="px-3 pb-2 pt-1 text-xs text-[#8fb6cc]">{floorName}{filterCount ? ` · ${filterCount} filter${filterCount === 1 ? "" : "s"} on` : ""} · tap a device for details</p>}
          {sheetTab && (
            <div id="twin-sheet" role="tabpanel" aria-labelledby={`twin-tab-${sheetTab}`} className="max-h-[45dvh] overflow-y-auto px-3 pb-4 pt-2">
              {sheetTab === "floors" && <div className="space-y-3">{floorList}{viewControls}<section><h2 className="twin-h">Views</h2>{viewsPanel}</section><section><h2 className="twin-h">Tours</h2>{toursPanel}</section></div>}
              {sheetTab === "filters" && (
                <div className="space-y-3">
                  <section><h2 className="twin-h">Problem layer</h2>{layerPanel}</section>
                  <section><h2 className="twin-h">Pathways</h2>{pathwaysPanel}</section>
                  <section><h2 className="twin-h">History</h2>{timePanel}</section>
                  {plans.length > 0 && <section><h2 className="twin-h">Plan vs installed</h2>{planPanel}</section>}
                  <section><h2 className="twin-h">Status</h2>{statusList}</section>
                  <section><h2 className="twin-h">Equipment types</h2>{typeList}</section>
                </div>
              )}
              {sheetTab === "find" && <div className="space-y-3">{findBox}<section><h2 className="twin-h">Notes</h2>{notesPanel}</section></div>}
              {sheetTab === "details" && (
                <div>
                  <div className="mb-1 flex justify-end"><button type="button" onClick={closeDetails} className="text-xs text-[#8fb6cc] hover:text-white" aria-label="Close details">Close</button></div>
                  {detailsBody}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {placingId != null && (
        <div role="status" className="absolute left-1/2 top-24 z-20 -translate-x-1/2 rounded-lg border border-[#2fd3ff] bg-[#04121fee] px-4 py-2 text-sm text-white">
          Click the device&apos;s exact spot inside its room. <button type="button" onClick={() => sceneRef.current?.cancelPlacing()} className="ml-2 text-[#5fd6ff] hover:underline">Cancel</button>
        </div>
      )}
      {dropping && (
        <div role="status" className="absolute bottom-6 left-1/2 z-20 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-[#2fd3ff] bg-[#04121fee] px-4 py-2 text-sm text-white">
          <span><b>{dropping.asset.tag}</b> · {formatDims(dropping.asset.dims)} · </span>
          <span className={dropping.at?.inside ? "text-[#3cf5a6]" : "text-[#ffb534]"}>
            {!dropping.at ? "move over the plan" : dropping.at.roomId == null ? "not in a room" : `${roomById.get(dropping.at.roomId)?.name ?? "room"}${dropping.at.inside ? "" : " (sticks out)"}`}
          </span>
          <span className="text-[#8fb6cc]">· {dropping.at?.rot ?? turnOf(dropping.asset)}°</span>
          <button type="button" onClick={() => sceneRef.current?.rotateDrop(-15)} className="twin-act" aria-label="Turn 15 degrees anticlockwise">⟲</button>
          <button type="button" onClick={() => sceneRef.current?.rotateDrop(15)} className="twin-act" aria-label="Turn 15 degrees clockwise">⟳</button>
          <button type="button" onClick={() => sceneRef.current?.rotateDrop(90)} className="twin-act">90°</button>
          <span className="text-xs text-[#8fb6cc]">Click to drop · R turns · Esc cancels</span>
          <button type="button" onClick={() => sceneRef.current?.cancelDrop()} className="text-[#5fd6ff] hover:underline">Cancel</button>
        </div>
      )}
      {toast && (toast.ok || toast.error) && placingId == null && (
        <div role={toast.error ? "alert" : "status"} className={`absolute left-1/2 top-24 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-[#04121fee] px-4 py-2 text-sm ${toast.error ? "border-[#ff4f62] text-[#ff8a96]" : "border-[#3cf5a6] text-[#b9ffe0]"}`}>
          <span>{toast.error ?? toast.ok}</span>
          {undo && !toast.error && <button type="button" onClick={undo.run} className="twin-act">{undo.label}</button>}
          <button type="button" onClick={() => setToast(null)} className="text-xs text-[#8fb6cc] hover:text-white" aria-label="Dismiss">Close</button>
        </div>
      )}
      {helpOpen && (
        <div role="dialog" aria-label="Keyboard shortcuts" className="twin-card pointer-events-auto absolute left-1/2 top-24 z-30 w-[22rem] max-w-[calc(100%-2rem)] -translate-x-1/2 p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="twin-h mb-0!">Keyboard shortcuts</h2><button type="button" onClick={() => setHelpOpen(false)} className="text-xs text-[#8fb6cc] hover:text-white">Close</button></div>
          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-sm">{SHORTCUTS.map((k) => <div key={k.keys} className="contents"><dt><kbd className="rounded border border-[#1d4f6d] px-1.5 text-xs text-white">{k.keys}</kbd></dt><dd className="text-[#d6f3ff]">{k.what}</dd></div>)}</dl>
          <p className="mt-2 text-[11px] text-[#8fb6cc]">Shortcuts are off while you type in a field.</p>
        </div>
      )}
      {walking && (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-end gap-3">
          <div className="twin-card px-3 py-2 text-xs text-[#d6f3ff]">Walking {floorName}: W A S D or arrows, Shift to hurry, drag to look. <button type="button" onClick={stopWalk} className="twin-act ml-2">Stop</button></div>
          <WalkStick onMove={(f, t) => sceneRef.current?.setWalkStick(f, t)} />
        </div>
      )}
      {tourPlay && tourStop && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#020a12f2] to-transparent px-6 pb-6 pt-16">
          <p className="mx-auto max-w-3xl text-center text-lg font-semibold text-white sm:text-2xl" aria-live="polite">{tourStop.caption || "\u00a0"}</p>
          <div className="mx-auto mt-3 flex max-w-3xl items-center justify-center gap-2 text-sm">
            <span className="text-[#8fb6cc]">{tourPlay.tour.name} · {tourPlay.i + 1} / {tourPlay.tour.stops.length}</span>
            <button type="button" onClick={() => setTourPlay((p) => (p && p.i > 0 ? { ...p, i: p.i - 1 } : p))} disabled={tourPlay.i === 0} className="twin-act" aria-label="Previous stop">←</button>
            <button type="button" onClick={() => setTourPlay((p) => (p ? { ...p, paused: !p.paused } : p))} className="twin-act">{tourPlay.paused ? "Play" : "Pause"}</button>
            <button type="button" onClick={() => setTourPlay((p) => (p && p.i + 1 < p.tour.stops.length ? { ...p, i: p.i + 1 } : p))} disabled={tourPlay.i + 1 >= tourPlay.tour.stops.length} className="twin-act" aria-label="Next stop">→</button>
            <button type="button" onClick={stopTour} className="twin-act">End</button>
          </div>
        </div>
      )}
      {hover && hoverCard && (
        <div className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-[#1d6f9a] bg-[#04121fe6] px-2.5 py-1.5 text-xs text-white backdrop-blur"
          style={{ left: hover.x + 14, top: hover.y + 10 }} aria-hidden>
          <p className="text-[13px] font-semibold">{hoverCard.title}</p>
          <p className="text-[#8fb6cc]">{hoverCard.sub}</p>
          {hoverCard.lines.length > 0 && <p className="mt-0.5">{hoverCard.lines.map((l, i) => <span key={i}>{i ? " · " : ""}<span style={{ color: l.color }}>{l.text}</span></span>)}</p>}
        </div>
      )}

      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-1 w-48 overflow-hidden rounded bg-[#0b2234]">
              <div className="h-full bg-[#2fd3ff] transition-[width]" style={{ width: `${(progress.loaded / Math.max(1, progress.total)) * 100}%` }} />
            </div>
            <p className="text-sm text-[#8fb6cc]">Building the model: {progress.loaded} of {progress.total} floors</p>
          </div>
        </div>
      )}
      {ready && progress.loaded < progress.total && (
        <p role="status" className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[#1d4f6d] bg-[#04121fcc] px-3 py-1 text-xs text-[#8fb6cc]">
          Loading floors: {progress.loaded} of {progress.total}
        </p>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="twin-card max-w-sm text-center">
            <p className="text-white">{error}</p>
            <Link href="/assets/map" className="mt-3 inline-block text-[#5fd6ff] hover:underline">Open the 2D floor map</Link>
          </div>
        </div>
      )}
      {/* The camera at the moment the render panel opens, as before the wave 30 split. */}
      {renderOpen && <RenderPanel data={{ ...data, assets: assetList }} floorId={floorId} plans={plans} initial={renderInit}
        // eslint-disable-next-line react-hooks/refs
        liveCamera={sceneRef.current?.getCamera() ?? null} canSaveDocs={!!data.can.editFacility}
        onClose={() => { setRenderOpen(false); setRenderInit(null); }}
        onSaveView={async (name, shared, settings) => {
          const v = currentView(); if (!v) return "The model isn't ready.";
          const fd = new FormData();
          fd.set("facilityId", String(data.facility.id)); fd.set("name", name); fd.set("state", encodeView(v)); fd.set("shared", shared ? "on" : ""); fd.set("render", JSON.stringify(settings));
          const res = await saveViewAction(null, fd);
          if (res?.view) setViews((l) => [...l, res.view!].sort((a, b) => a.name.localeCompare(b.name)));
          return res?.error ?? null;
        }} />}
    </div>
  );
}
