"use client";
/**
 * Presentation renders (wave 7, part F1): the Render dialog of the 3D view. Choose a floor (or one department of
 * it), the view, cut height, look, furniture, labels and size; preview; download a PNG; or make a floor book of every
 * floor to print or save as PDF. The heavy renderer (studio.ts) loads only when the dialog opens.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FloorGeometry, TwinData } from "../types";
import type { RenderOptions, RenderStudio } from "./studio";
import type { PlanChoice, PlanPayload } from "@/lib/assets/plan-installed-server";

/** Render settings as saved with a view (wave 7). */
export type RenderSettings = {
  floorId?: number; departmentId?: number | null; view?: RenderOptions["view"]; cutHeight?: number; look?: RenderOptions["look"];
  kits?: boolean; labels?: boolean; titleBlock?: boolean; transparent?: boolean; size?: "1080p" | "4K" | "8K";
  labelMode?: "rooms" | "departments" | "both" | "none"; people?: boolean; format?: "png" | "jpeg"; eyeRoomId?: number | null;
  equipment?: "installed" | "planned" | "both"; boqId?: number | null;
};

type Size = "1080p" | "4K" | "8K";
const SIZES: Record<Size, [number, number]> = { "1080p": [1920, 1080], "4K": [3840, 2160], "8K": [7680, 4320] };

async function loadGeometry(id: number): Promise<FloorGeometry | null> {
  const res = await fetch(`/assets/3d/geometry/${id}`);
  return res.ok ? ((await res.json()) as FloorGeometry) : null;
}

export function RenderPanel({ data, floorId: initialFloor, onClose, plans = [], initial, onSaveView, liveCamera, canSaveDocs = false }: {
  /** The live view's camera (relative to the floor), for "Current view". */
  liveCamera?: { cam: [number, number, number]; tgt: [number, number, number] } | null;
  /** May save renders to the hospital's documents (facilities.edit). */
  canSaveDocs?: boolean;
  data: TwinData; floorId: number | null; onClose: () => void;
  /** BOQs of the hospital, for drawing planned equipment. */
  plans?: PlanChoice[];
  /** Settings from a saved view. */
  initial?: RenderSettings | null;
  /** Save the current model view with these render settings; returns an error or null. */
  onSaveView?: (name: string, shared: boolean, settings: RenderSettings) => Promise<string | null>;
}) {
  const floors = useMemo(() => [...data.floors].sort((a, b) => a.elevation - b.elevation), [data.floors]);
  const i0 = initial ?? {};
  const [floorId, setFloorId] = useState<number>((i0.floorId && floors.some((f) => f.id === i0.floorId) ? i0.floorId : null) ?? initialFloor ?? floors.find((f) => f.hasCad)?.id ?? floors[0]?.id);
  const [departmentId, setDepartmentId] = useState<number | null>(i0.departmentId ?? null);
  const [view, setView] = useState<RenderOptions["view"]>(i0.view ?? "dollhouse");
  const [cutHeight, setCut] = useState(i0.cutHeight ?? 1.2);
  const [look, setLook] = useState<RenderOptions["look"]>(i0.look ?? "daylight");
  const [kits, setKits] = useState(i0.kits ?? true);
  const [labelMode, setLabelMode] = useState<"rooms" | "departments" | "both" | "none">(i0.labelMode ?? (i0.labels === false ? "none" : "rooms"));
  const [people, setPeople] = useState(i0.people ?? false);
  const [format, setFormat] = useState<"png" | "jpeg">(i0.format ?? "png");
  const [eyeRoomId, setEyeRoomId] = useState<number | null>(i0.eyeRoomId ?? null);
  const [docMsg, setDocMsg] = useState<string | null>(null);
  const [titleBlock, setTitleBlock] = useState(i0.titleBlock ?? true);
  const [transparent, setTransparent] = useState(i0.transparent ?? false);
  const [size, setSize] = useState<Size>(i0.size ?? "4K");
  const [equipment, setEquipment] = useState<"installed" | "planned" | "both">(i0.equipment && plans.length ? i0.equipment : "installed");
  const [boqId, setBoqId] = useState<number | null>(i0.boqId && plans.some((p) => p.id === i0.boqId) ? i0.boqId : plans[0]?.id ?? null);
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [saveShared, setSaveShared] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const settings = (): RenderSettings => ({ floorId, departmentId: deptValid, view: view === "camera" ? "dollhouse" : view, cutHeight, look, kits, labelMode, people, format, eyeRoomId, titleBlock, transparent, size, equipment, boqId });
  // The chosen BOQ's plan, loaded when planned equipment is asked for.
  useEffect(() => {
    if (equipment === "installed" || boqId == null || plan?.boq.id === boqId) return;
    let stop = false;
    void fetch(`/assets/3d/plan?facilityId=${data.facility.id}&boqId=${boqId}`, { cache: "no-store" })
      .then(async (r) => { const p = (await r.json()) as PlanPayload & { error?: string }; if (!r.ok) throw new Error(p.error ?? String(r.status)); if (!stop) setPlan(p); })
      .catch((e: Error) => { if (!stop) setError(`The BOQ couldn't be loaded (${e.message}).`); });
    return () => { stop = true; };
  }, [equipment, boqId, plan, data.facility.id]);
  const planned = useMemo(() => {
    if (equipment === "installed" || !plan || plan.boq.id !== boqId) return undefined;
    return plan.departments.map((d) => ({ departmentId: d.departmentId, items: d.items.map((it) => ({ code: it.code, n: equipment === "planned" ? it.planned : it.missing })).filter((it) => it.n > 0) }));
  }, [equipment, plan, boqId]);
  const [preview, setPreview] = useState<string | null>(null);
  const studio = useRef<RenderStudio | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  // Departments with rooms on the chosen floor.
  const depts = useMemo(() => {
    const ids = new Set(data.rooms.filter((r) => r.floorId === floorId && r.departmentId != null).map((r) => r.departmentId!));
    return data.departments.filter((d) => ids.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.rooms, data.departments, floorId]);
  const deptValid = departmentId != null && depts.some((d) => d.id === departmentId) ? departmentId : null;

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  useEffect(() => () => { studio.current?.dispose(); studio.current = null; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function getStudio(): Promise<RenderStudio> {
    if (studio.current) return studio.current;
    const { RenderStudio } = await import("./studio");
    // The hospital's room kits (Planning › Room kits); the built-in ones if they can't be read.
    const kits = await fetch("/assets/3d/kits", { cache: "no-store" }).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
    studio.current = new RenderStudio(data, loadGeometry, Array.isArray(kits) && kits.length ? kits : undefined);
    return studio.current;
  }
  const opts = (w: number, h: number, floor = floorId, dept = deptValid): RenderOptions => ({
    floorId: floor, departmentId: dept, view, cutHeight, kits, labels: labelMode !== "none", labelMode, people, eyeRoomId, camera: liveCamera ?? null,
    look, width: w, height: h, titleBlock, transparent: transparent && format === "png", facilityName: data.facility.name,
    equipment: equipment !== "installed" && planned ? equipment : "installed", planned, planName: plan ? `${plan.boq.name} v${plan.boq.version}` : undefined,
    logo: data.facility.logo ?? null, brandColor: data.facility.brandColor ?? null,
  });
  const fileBase = () => {
    const f = floors.find((x) => x.id === floorId)?.name ?? "floor";
    const d = deptValid != null ? `-${data.departments.find((x) => x.id === deptValid)?.code ?? "dept"}` : "";
    return `${data.facility.code}-${f}${d}-render`.replace(/[^\w.-]+/g, "-").toLowerCase();
  };
  async function run<T>(label: string, job: (s: RenderStudio) => Promise<T>): Promise<T | null> {
    setBusy(label); setError(null);
    try { return await job(await getStudio()); }
    catch (e) { setError((e as Error).message || "The render couldn't be made."); return null; }
    finally { setBusy(null); }
  }
  const toBlob = (c: HTMLCanvasElement, type = "image/png", q?: number) =>
    new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("The image couldn't be saved."))), type, q));

  async function doPreview() {
    const c = await run("Making the preview…", (s) => s.render(opts(1280, 720), setBusy));
    if (c) setPreview(URL.createObjectURL(await toBlob(c, "image/jpeg", 0.9)));
  }
  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
  };
  const ext = format === "jpeg" ? "jpg" : "png";
  async function makeImage(): Promise<Blob | null> {
    const [w, h] = SIZES[size];
    const c = await run(`Rendering ${size}…`, (s) => s.render(opts(w, h), setBusy));
    return c ? toBlob(c, format === "jpeg" ? "image/jpeg" : "image/png", format === "jpeg" ? 0.92 : undefined) : null;
  }
  async function doDownload() {
    const b = await makeImage(); if (b) saveBlob(b, `${fileBase()}-${size}.${ext}`);
  }
  /** Keep the render in the hospital's documents (wave 8). */
  async function doSaveDoc() {
    const b = await makeImage(); if (!b) return;
    const fd = new FormData(); fd.set("facilityId", String(data.facility.id)); fd.set("file", new File([b], `${fileBase()}-${size}.${ext}`, { type: b.type }));
    setBusy("Saving to the hospital's documents…");
    const { saveRenderDocumentAction } = await import("@/app/assets/3d/actions");
    const res = await saveRenderDocumentAction(null, fd);
    setBusy(null); setDocMsg(res?.error ?? res?.ok ?? null);
  }
  /** Every floor's image in one ZIP (wave 8). */
  async function doZip() {
    const [w, h] = size === "8K" ? SIZES["4K"] : SIZES[size];
    const files: { name: string; data: Uint8Array }[] = [];
    const ok = await run("Rendering every floor…", async (s) => {
      for (const [i, f] of floors.entries()) {
        if (!data.rooms.some((r) => r.floorId === f.id)) continue;
        setBusy(`Floor ${i + 1} of ${floors.length}: ${f.name}…`);
        const c = await s.render(opts(w, h, f.id, null), () => {});
        const b = await toBlob(c, format === "jpeg" ? "image/jpeg" : "image/png", format === "jpeg" ? 0.92 : undefined);
        files.push({ name: `${String(i + 1).padStart(2, "0")} ${f.name}.${ext}`.replace(/[\\/:*?"<>|]/g, "-"), data: new Uint8Array(await b.arrayBuffer()) });
      }
      return true;
    });
    if (!ok || !files.length) return;
    const { zip } = await import("@/lib/zip");
    saveBlob(new Blob([zip(files) as BlobPart], { type: "application/zip" }), `${data.facility.code}-floor-book-images.zip`.toLowerCase());
  }
  async function doBook() {
    const [w, h] = size === "8K" ? SIZES["4K"] : SIZES[size];
    const pages: { name: string; img: string; depts: string[] }[] = [];
    const ok = await run("Making the floor book…", async (s) => {
      for (const [i, f] of floors.entries()) {
        if (!data.rooms.some((r) => r.floorId === f.id)) continue;
        setBusy(`Floor book: ${f.name} (${i + 1} of ${floors.length})…`);
        const c = await s.render(opts(w, h, f.id, null), () => {});
        const blob = await toBlob(c, "image/jpeg", 0.9);
        const img = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
        const ids = new Set(data.rooms.filter((r) => r.floorId === f.id && r.departmentId != null).map((r) => r.departmentId!));
        pages.push({ name: f.name, img, depts: data.departments.filter((d) => ids.has(d.id)).map((d) => d.name).sort() });
      }
      return true;
    });
    if (!ok || !pages.length) return;
    const html = floorBookHtml(data.facility.name, pages, { logo: data.facility.logo ?? null, color: data.facility.brandColor ?? null });
    const win = window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank");
    if (!win) setError("Your browser blocked the floor book window. Allow pop-ups for this site and try again.");
  }

  const radio = <T extends string>(name: string, value: T, set: (v: T) => void, items: [T, string][]) => (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={name}>
      {items.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => set(v)}
          className={`rounded-md border px-2.5 py-1 text-sm font-medium ${value === v ? "border-primary bg-primary-soft text-primary-strong" : "border-line bg-surface text-muted hover:text-ink"}`}>{label}</button>
      ))}
    </div>
  );
  const check = (label: string, value: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="mt-0.5" />
      <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span></label>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="render-title"
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-surface text-ink shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 id="render-title" className="text-lg font-semibold">Presentation render</h2>
            <p className="text-xs text-muted">A furnished image of a floor, made from the drawings and the equipment register. Furniture is illustrative and labelled as such.</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} className="rounded-md px-2 py-1 text-muted hover:text-ink" aria-label="Close">✕</button>
        </div>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[19rem_1fr]">
          <div className="space-y-4">
            <label className="block text-sm font-semibold">Floor
              <select value={floorId} onChange={(e) => { setFloorId(Number(e.target.value)); setDepartmentId(null); }} className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm font-normal">
                {floors.map((f) => <option key={f.id} value={f.id}>{f.name}{f.hasCad ? "" : " (no drawing)"}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">Area
              <select value={deptValid ?? ""} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)} className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm font-normal">
                <option value="">Whole floor</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name} (close-up)</option>)}
              </select>
            </label>
            <div><p className="mb-1 text-sm font-semibold">View</p>{radio("View", view, setView, [["dollhouse", "Dollhouse"], ["iso", "Isometric"], ["plan", "Plan"], ["eye", "Eye level"], ...(liveCamera ? [["camera", "Current view"] as ["camera", string]] : [])])}
              {view === "eye" && (
                <select value={eyeRoomId ?? ""} onChange={(e) => setEyeRoomId(e.target.value ? Number(e.target.value) : null)} aria-label="Room to stand in" className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm">
                  <option value="">The largest room in view</option>
                  {data.rooms.filter((r) => r.floorId === floorId && r.type !== "CORRIDOR").sort((a, b) => a.name.localeCompare(b.name)).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
                </select>
              )}
              {view === "camera" && <p className="mt-1 text-xs text-muted">The camera of the 3D view as it is now, on this floor.</p>}
            </div>
            <label className="block text-sm font-semibold">Wall cut height: {cutHeight.toFixed(1)} m
              <input type="range" min={1} max={1.5} step={0.1} value={cutHeight} onChange={(e) => setCut(Number(e.target.value))} className="mt-1 block w-full" />
            </label>
            <div><p className="mb-1 text-sm font-semibold">Look</p>{radio("Look", look, setLook, [["daylight", "Daylight"], ["warm", "Warm interior"]])}</div>
            <div className="space-y-2">
              {check("Furniture", kits, setKits, "Room kits by room type (illustrative); registered equipment is always shown")}
              {check("People for scale", people, setPeople, "A few standing figures in waiting areas, lobbies and corridors")}
              {check("Title block", titleBlock, setTitleBlock, "Floor, hospital, date, scale bar, what's shown")}
              {check("Transparent background", transparent, setTransparent)}
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">Equipment</p>
              {plans.length ? radio("Equipment", equipment, setEquipment, [["installed", "Installed"], ["planned", "Planned (BOQ)"], ["both", "Both"]]) : <p className="text-xs text-muted">Installed (the register). Planned equipment needs a BOQ of this hospital.</p>}
              {equipment !== "installed" && plans.length > 0 && (
                <select value={boqId ?? ""} onChange={(e) => { setBoqId(Number(e.target.value)); setPlan(null); }} aria-label="BOQ" className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm">
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name} v{p.version}</option>)}
                </select>
              )}
              {equipment !== "installed" && <p className="mt-1 text-xs text-muted">{equipment === "planned" ? "Every unit the BOQ plans, in its department's rooms (pale blue)." : "The register, plus units the BOQ plans that aren't installed yet (pale blue)."}{!planned ? " Loading the BOQ…" : ""}</p>}
            </div>
            <div><p className="mb-1 text-sm font-semibold">Labels</p>{radio("Labels", labelMode, setLabelMode, [["rooms", "Rooms"], ["departments", "Departments"], ["both", "Both"], ["none", "None"]])}
              <p className="mt-1 text-xs text-muted">Names exactly as in the register.</p></div>
            <div><p className="mb-1 text-sm font-semibold">File</p>{radio("File type", format, setFormat, [["png", "PNG"], ["jpeg", "JPEG (smaller)"]])}</div>
            <div><p className="mb-1 text-sm font-semibold">Size</p>{radio("Size", size, setSize, [["1080p", "1080p"], ["4K", "4K"], ["8K", "8K"]])}
              {size === "8K" && <p className="mt-1 text-xs text-muted">8K is rendered in tiles; it takes longer and needs a capable computer.</p>}</div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-line bg-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, nothing for next/image to optimise */}
              {preview ? <img src={preview} alt="Render preview" className="h-full w-full object-contain" />
                : <p className="px-6 text-center text-sm text-muted">{busy ?? "Press Preview to see the render."}</p>}
            </div>
            {busy && preview && <p className="text-sm text-muted" aria-live="polite">{busy}</p>}
            {docMsg && <p className="text-sm text-muted" aria-live="polite">{docMsg}</p>}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={doPreview} disabled={!!busy} className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold hover:border-primary disabled:opacity-50">Preview</button>
              <button type="button" onClick={doDownload} disabled={!!busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Download {format === "jpeg" ? "JPEG" : "PNG"} ({size})</button>
              <button type="button" onClick={doBook} disabled={!!busy} className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold hover:border-primary disabled:opacity-50">Floor book (all floors)</button>
              <button type="button" onClick={doZip} disabled={!!busy} className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold hover:border-primary disabled:opacity-50">All floors as images (ZIP)</button>
              {canSaveDocs && <button type="button" onClick={doSaveDoc} disabled={!!busy} className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold hover:border-primary disabled:opacity-50">Save to the hospital&apos;s documents</button>}
            </div>
            <p className="text-xs text-muted">The floor book renders every floor with these settings (whole floors, up to 4K) and opens it ready to print or save as PDF.</p>
            {onSaveView && (
              <div className="border-t border-line pt-3">
                {saveName == null ? (
                  <button type="button" onClick={() => { setSaveName(""); setSaveMsg(null); }} className="text-sm font-semibold text-primary hover:underline">Save these settings with a view…</button>
                ) : (
                  <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); const err = await onSaveView(saveName.trim(), saveShared, settings()); setSaveMsg(err ?? "Saved. Open it under Views and press Render to remake this image or book."); if (!err) setSaveName(null); }}>
                    <input value={saveName} onChange={(e) => setSaveName(e.target.value)} required maxLength={80} placeholder="View name, e.g. Floor book for the board" aria-label="View name" className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm" />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={saveShared} onChange={(e) => setSaveShared(e.target.checked)} />Share</label>
                    <button className="rounded-md border border-line px-3 py-1 text-sm font-semibold hover:border-primary">Save</button>
                    <button type="button" onClick={() => setSaveName(null)} className="text-sm text-muted">Cancel</button>
                  </form>
                )}
                {saveMsg && <p className="mt-1 text-xs text-muted" aria-live="polite">{saveMsg}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A printable floor book: cover, then one landscape page per floor with its departments. */
export function floorBookHtml(facility: string, pages: { name: string; img: string; depts: string[] }[], brand: { logo?: string | null; color?: string | null } = {}): string {
  const accent = brand.color && /^#[0-9a-f]{6}$/i.test(brand.color) ? brand.color : "#c62f2f";
  const logo = brand.logo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(brand.logo) ? brand.logo : null;
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(facility)} — floor book</title>
<style>
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif; color: #1d252c; background: #e9ecef; }
.page { width: 297mm; height: 210mm; background: #fff; margin: 8mm auto; position: relative; overflow: hidden; page-break-after: always; box-shadow: 0 2px 10px rgb(0 0 0 / .15); }
.cover { display: flex; flex-direction: column; justify-content: center; padding: 0 24mm; }
.cover h1 { font-size: 34pt; margin: 0 0 4mm; letter-spacing: .5pt; }
.cover .bar { width: 60mm; height: 3mm; background: ${accent}; margin-bottom: 8mm; }
.cover .logo { max-height: 28mm; max-width: 90mm; margin-bottom: 8mm; align-self: flex-start; }
.plogo { position: absolute; bottom: 6mm; right: 10mm; max-height: 10mm; max-width: 40mm; opacity: .9; }
.cover p { font-size: 13pt; color: #5b6670; margin: 1mm 0; }
.cover ol { margin-top: 10mm; columns: 2; font-size: 12pt; color: #3b4650; }
.head { position: absolute; top: 0; left: 0; background: #eef0f2; padding: 5mm 10mm; font-size: 20pt; font-weight: 700; color: ${accent}; letter-spacing: 1pt; }
.depts { position: absolute; top: 6mm; right: 10mm; max-width: 140mm; text-align: right; font-size: 9pt; color: #5b6670; }
.img { position: absolute; top: 20mm; left: 8mm; right: 8mm; bottom: 8mm; display: flex; align-items: center; justify-content: center; }
.img img { max-width: 100%; max-height: 100%; }
.tools { text-align: center; margin: 6mm; }
.tools button { font: inherit; font-weight: 600; padding: 2mm 6mm; border-radius: 2mm; border: 0; background: #0a84c1; color: #fff; cursor: pointer; }
@media print { body { background: #fff; } .page { margin: 0; box-shadow: none; } .tools { display: none; } }
</style></head><body>
<div class="tools"><button onclick="window.print()">Print or save as PDF</button></div>
<section class="page cover">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}<div class="bar"></div><h1>${esc(facility)}</h1><p>Floor book · ${esc(date)}</p>
<p>Made from the drawings and the equipment register. Furniture is illustrative.</p>
<ol>${pages.map((p) => `<li>${esc(p.name)}</li>`).join("")}</ol></section>
${pages.map((p) => `<section class="page"><div class="head">${esc(p.name.toUpperCase())}</div>
<div class="depts">${p.depts.map(esc).join(" · ")}</div><div class="img"><img src="${p.img}" alt="${esc(p.name)}"></div>${logo ? `<img class="plogo" src="${logo}" alt="">` : ""}</section>`).join("\n")}
</body></html>`;
}
