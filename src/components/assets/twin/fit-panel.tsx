"use client";
/**
 * "Will it fit?" in the 3D room details (wave 9, D1): the room's surveyed site data, and a make and model's site
 * requirements checked against it — placed automatically at the best turn, or by hand (click a spot, turn it). The
 * footprint, service space and, for MRI, the 5 gauss line are drawn on the floor.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { setRoomSiteAction, type RoomSite } from "@/app/assets/3d/actions";
import { checkFit, polygonArea, type FitResult, type Placement, type SiteRoom } from "@/lib/assets/site-fit";
import type { TwinFloor, TwinRoom, TwinSiteModel } from "./types";

export type Outline = { floorId: number; pts: [number, number][]; color: string; fill?: number; dashed?: boolean };
const SVC = [["chilledWater", "Chilled water"], ["quenchPipe", "Quench pipe"], ["rfShield", "RF shielding"], ["leadLined", "Lead shielding"]] as const;
const ICON = { ok: "✓", fail: "✕", unknown: "?" } as const;
const TONE = { ok: "text-[#7dffc0]", fail: "text-[#ff8a96]", unknown: "text-[#ffc46b]" } as const;

/** Surveys saved in this visit (the panel is keyed by room, so it would otherwise show the page's first copy). */
const savedSites = new Map<number, RoomSite>();

export function toSiteRoom(r: TwinRoom, f: TwinFloor, site?: RoomSite | null): SiteRoom {
  const k = f.unitsPerMetre || 10, s = site ?? r.site ?? null;
  return { id: r.id, name: r.name, poly: r.poly.map(([x, y]) => [x / k, y / k]), ceilingM: s?.ceilingM, doorWidthM: s?.doorWidthM, doorHeightM: s?.doorHeightM, floorLoadKgM2: s?.floorLoadKgM2, services: s?.services ?? null };
}

export function FitPanel({ room, floor, floorRooms, models, canEdit, facilityId, onOverlay, pickPoint, onToast }: {
  room: TwinRoom; floor: TwinFloor; floorRooms: TwinRoom[]; models: TwinSiteModel[]; canEdit: boolean; facilityId: number;
  onOverlay: (o: Outline[] | null) => void;
  pickPoint: (done: (p: { x: number; y: number; roomId: number | null } | null) => void) => void;
  onToast: (t: { ok?: string; error?: string }) => void;
}) {
  const [site, setSite] = useState<RoomSite | null>(savedSites.get(room.id) ?? room.site ?? null);
  const [modelId, setModelId] = useState<number | null>(null);
  const [at, setAt] = useState<Placement | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elsewhere, setElsewhere] = useState<{ id: number; name: string }[] | null>(null);
  const model = models.find((m) => m.id === modelId) ?? null;
  const k = floor.unitsPerMetre || 10;
  const sr = useMemo(() => toSiteRoom(room, floor, site), [room, floor, site]);
  const others = useMemo(() => floorRooms.filter((r) => r.type !== "CORRIDOR" || r.poly.length >= 3).map((r) => toSiteRoom(r, floor)), [floorRooms, floor]);
  const fit: FitResult | null = useMemo(() => (model ? checkFit(model.req, sr, others, at ?? undefined) : null), [model, sr, others, at]);

  useEffect(() => {
    if (!fit) { onOverlay(null); return; }
    const plan = (p: [number, number][]) => p.map(([x, z]) => [x * k, z * k] as [number, number]);
    const good = fit.checks.find((c) => c.key === "footprint")?.status === "ok";
    onOverlay([
      { floorId: floor.id, pts: plan(fit.clearance), color: good ? "#3cf5a6" : "#ffb347", fill: 0.12, dashed: true },
      { floorId: floor.id, pts: plan(fit.footprint), color: good ? "#3cf5a6" : "#ff5f6d", fill: 0.45 },
      ...(fit.fringe ? [{ floorId: floor.id, pts: plan(fit.fringe), color: fit.fringeRooms.length ? "#ff5fd2" : "#c58bff", fill: 0.08, dashed: true }] : []),
    ]);
  }, [fit, floor.id, k, onOverlay]);
  useEffect(() => () => onOverlay(null), [onOverlay]);

  const placeByHand = () => pickPoint((p) => {
    if (!p) return;
    if (p.roomId !== room.id) { onToast({ error: "Click inside this room." }); return; }
    setAt({ x: p.x / k, z: p.y / k, rot: fit?.placement.rot ?? 0 });
  });
  const turn = () => { const p = fit?.placement; if (p) setAt({ ...p, rot: p.rot + Math.PI / 2 }); };
  const findElsewhere = () => {
    if (!model) return;
    const need = (model.req.lengthM + 2 * model.req.clearanceM) * (model.req.widthM + 2 * model.req.clearanceM);
    setElsewhere(floorRooms.filter((r) => r.id !== room.id && r.type !== "CORRIDOR").map((r) => toSiteRoom(r, floor)).filter((r) => polygonArea(r.poly) >= need)
      .map((r) => ({ r, f: checkFit(model.req, r, []) }))
      .filter(({ f }) => f.fits).map(({ r }) => ({ id: r.id, name: r.name })).slice(0, 12));
  };
  const save = async (fd: FormData) => {
    setBusy(true); fd.set("roomId", String(room.id));
    const res = await setRoomSiteAction(null, fd); setBusy(false);
    if (res?.site) { savedSites.set(room.id, res.site); setSite(res.site); setEditing(false); }
    onToast({ ok: res?.ok, error: res?.error });
  };
  const sv = site?.services ?? null;
  const tri = (v: boolean | undefined) => (v === true ? "yes" : v === false ? "no" : "");

  return (
    <div className="mt-3 border-t border-[#123a55] pt-2 text-[13px]">
      <p className="font-semibold text-[#5fd6ff]">Will it fit?</p>
      <p className="text-[11px] text-[#8fb6cc]">
        {site && (site.ceilingM || site.doorWidthM || site.floorLoadKgM2 || sv) ? [
          site.ceilingM && `ceiling ${site.ceilingM} m`, site.doorWidthM && `door ${site.doorWidthM}${site.doorHeightM ? ` × ${site.doorHeightM}` : ""} m`,
          site.floorLoadKgM2 && `floor ${site.floorLoadKgM2} kg/m²`, sv?.powerKva != null && `${sv.powerKva} kVA`,
          ...SVC.filter(([s]) => sv?.[s]).map(([, l]) => l.toLowerCase()),
        ].filter(Boolean).join(" · ") : "Not surveyed yet: ceiling, door, floor load and services show as unknown."}
        {canEdit && <> <button type="button" onClick={() => setEditing((e) => !e)} className="text-[#5fd6ff] hover:underline">{editing ? "Close" : "Edit survey"}</button></>}
      </p>
      {editing && (
        <form action={save} className="mt-1 grid grid-cols-2 gap-1.5 text-[12px]">
          {([["ceilingM", "Clear ceiling (m)", site?.ceilingM], ["doorWidthM", "Door width (m)", site?.doorWidthM], ["doorHeightM", "Door height (m)", site?.doorHeightM], ["floorLoadKgM2", "Floor load (kg/m²)", site?.floorLoadKgM2], ["powerKva", "Power (kVA)", sv?.powerKva]] as const).map(([n, l, v]) => (
            <label key={n} className="text-[#8fb6cc]">{l}<input name={n} defaultValue={v ?? ""} inputMode="decimal" className="twin-input py-0.5" /></label>
          ))}
          {SVC.map(([n, l]) => (
            <label key={n} className="text-[#8fb6cc]">{l}
              <select name={n} defaultValue={tri(sv?.[n])} className="twin-input py-0.5"><option value="">Not known</option><option value="yes">Present</option><option value="no">Not present</option></select>
            </label>
          ))}
          <button disabled={busy} className="twin-act col-span-2">{busy ? "Saving…" : "Save survey"}</button>
        </form>
      )}
      {models.length === 0 ? (
        <p className="mt-1 text-[11px] text-[#8fb6cc]">No make and model has site data yet. Add it on the model&apos;s page in the <Link href="/catalogue/models" className="text-[#5fd6ff] hover:underline">catalogue</Link>.</p>
      ) : (
        <>
          <select aria-label="Model to check" value={modelId ?? ""} onChange={(e) => { setModelId(e.target.value ? Number(e.target.value) : null); setAt(null); setElsewhere(null); }} className="twin-input mt-1 py-0.5">
            <option value="">Check a make and model…</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.typeName}){m.typical ? " — typical values" : ""}</option>)}
          </select>
          {model && fit && (
            <div className="mt-1.5">
              <p className={`font-semibold ${fit.fits ? (fit.unknown ? "text-[#ffc46b]" : "text-[#7dffc0]") : "text-[#ff8a96]"}`}>
                {fit.fits ? (fit.unknown ? `Fits so far: ${fit.unknown} to confirm on site` : "Fits") : "Doesn't fit as placed"}
              </p>
              {model.typical && <p className="text-[11px] text-[#ffc46b]">Checked with typical values, not this model&apos;s: replace them with the manufacturer&apos;s site planning guide.</p>}
              <ul className="mt-1 space-y-0.5">
                {fit.checks.map((c) => <li key={c.key} className="flex gap-1.5"><span className={`w-3 shrink-0 ${TONE[c.status]}`} aria-label={c.status}>{ICON[c.status]}</span><span><span className="text-white">{c.label}</span> <span className="text-[11px] text-[#8fb6cc]">{c.detail}</span></span></li>)}
              </ul>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button type="button" onClick={placeByHand} className="twin-act">Place by hand</button>
                <button type="button" onClick={turn} className="twin-act">Turn 90°</button>
                {at && <button type="button" onClick={() => setAt(null)} className="twin-act">Best spot</button>}
                <button type="button" onClick={findElsewhere} className="twin-act">Other rooms on this floor</button>
                <a href={`/facilities/${facilityId}/site-fit?roomId=${room.id}&modelId=${model.id}${at ? `&x=${at.x.toFixed(2)}&z=${at.z.toFixed(2)}&rot=${at.rot.toFixed(3)}` : ""}`} target="_blank" rel="noreferrer" className="twin-act">Readiness sheet</a>
              </div>
              {elsewhere && <p className="mt-1 text-[11px] text-[#8fb6cc]">{elsewhere.length ? `Also fits (by size and what's surveyed): ${elsewhere.map((r) => r.name).join(", ")}.` : "No other room on this floor fits it."}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
