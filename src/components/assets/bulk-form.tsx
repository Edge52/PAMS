"use client";
/**
 * Bulk placement: one device type × quantity spread across a department's rooms with a live preview.
 * "12 monitors, one in each ICU bed" = department Adult ICU, quantity 12, one per bed.
 */
import { useMemo, useState, type ReactNode } from "react";
import { distribute, DIST_MODES, parseSerials, type DistMode } from "@/lib/assets/distribution";
import type { FormState } from "@/lib/assets/forms";
import { humanize } from "@/lib/status";
import { ActionForm } from "./action-form";

type Room = { id: number; code: string; name: string; beds: number; type: string };
type Dept = { id: number; facilityId: number; name: string; code: string; rooms: Room[] };
type DType = { id: number; code: string; name: string; groupName: string | null; categoryName: string | null };

const ctl = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px] focus:border-primary focus:outline-none";

function F({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function BulkForm({ facilities, departments, types, statuses, currencies, initial, action }: {
  facilities: { id: number; code: string; name: string }[]; departments: Dept[]; types: DType[]; statuses: string[]; currencies: readonly string[];
  initial: { deviceTypeId?: number | null; departmentId?: number | null; today: string };
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const initialDept = departments.find((d) => d.id === initial.departmentId);
  const [facilityId, setFacilityId] = useState(initialDept?.facilityId ?? facilities[0]?.id ?? 0);
  const [deptId, setDeptId] = useState<number | "">(initialDept?.id ?? "");
  const [quantity, setQuantity] = useState(12);
  const [mode, setMode] = useState<DistMode>("PER_BED");
  const [target, setTarget] = useState<number | "">("");
  const [manual, setManual] = useState<Record<number, number>>({});
  const [serialText, setSerialText] = useState("");

  const deptOptions = departments.filter((d) => d.facilityId === facilityId);
  const dept = deptOptions.find((d) => d.id === deptId);
  const rooms = dept?.rooms.filter((r) => r.type !== "CORRIDOR") ?? [];
  const result = distribute({ mode, rooms, quantity, targetRoomId: target === "" ? null : target, manual });
  const countFor = (id: number) => result.allocations.find((a) => a.roomId === id)?.count ?? 0;
  const serials = parseSerials(serialText);
  const bedTotal = rooms.reduce((s, r) => s + r.beds, 0);
  const groups = useMemo(() => {
    const m = new Map<string, DType[]>();
    for (const t of types) { const k = `${t.categoryName ?? "Other"} › ${t.groupName ?? "Other"}`; m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m.entries()];
  }, [types]);

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="facilityId" value={facilityId} />
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 className="mb-3 text-[15px] font-semibold">1 · What</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <F label="Device type" className="sm:col-span-2">
            <select name="deviceTypeId" required defaultValue={initial.deviceTypeId ?? ""} className={ctl}>
              <option value="">Choose a device type…</option>
              {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.code}</option>)}</optgroup>)}
            </select>
          </F>
          <F label="Quantity"><input type="number" name="quantity" min={1} max={500} required value={quantity} onChange={(e) => setQuantity(Math.max(0, Math.min(500, Number(e.target.value) || 0)))} className={ctl} /></F>
          <F label="Status" hint="Blank: in service"><select name="status" defaultValue="" className={ctl}><option value="">Automatic</option>{statuses.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></F>
          <F label="Manufacturer"><input name="manufacturer" className={ctl} placeholder="Philips" list="dl-makers" autoComplete="off" /></F>
          <F label="Model"><input name="model" className={ctl} placeholder="IntelliVue MX750" list="dl-models" autoComplete="off" /></F>
          <F label="Install date"><input type="date" name="installDate" defaultValue={initial.today} className={ctl} /></F>
          <F label="Warranty months"><input type="number" name="warrantyMonths" min={0} max={240} defaultValue={24} className={ctl} /></F>
          <F label="Purchase date"><input type="date" name="purchaseDate" className={ctl} /></F>
          <F label="Unit cost"><input type="number" name="unitCost" min={0} step="0.01" className={ctl} /></F>
          <F label="Currency"><select name="currency" defaultValue="USD" className={ctl}>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select></F>
          <F label="Serial numbers" className="sm:col-span-2 lg:col-span-4"
            hint={serials.length ? <span className={serials.length === result.total ? "text-ok" : "text-warn"}>{serials.length} serial{serials.length === 1 ? "" : "s"} for {result.total} units{serials.length !== result.total ? " — give one per unit or none" : " — assigned in the order of the preview"}</span> : "Optional. One per line (or comma separated), in the order of the preview below."}>
            <textarea name="serials" rows={3} value={serialText} onChange={(e) => setSerialText(e.target.value)} className={`${ctl} font-mono`} placeholder={"DE12345601\nDE12345602"} />
          </F>
        </div>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 className="mb-3 text-[15px] font-semibold">2 · Where</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {facilities.length > 1 && (
            <F label="Facility"><select value={facilityId} onChange={(e) => { setFacilityId(Number(e.target.value)); setDeptId(""); }} className={ctl}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}</select></F>
          )}
          <F label="Department">
            <select name="departmentId" required value={deptId} onChange={(e) => { setDeptId(e.target.value ? Number(e.target.value) : ""); setTarget(""); setManual({}); }} className={ctl}>
              <option value="">Choose a department…</option>
              {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.rooms.length} rooms)</option>)}
            </select>
          </F>
        </div>
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-semibold">Distribute across rooms</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {DIST_MODES.map((m) => (
              <label key={m.value} className={`flex cursor-pointer gap-2 rounded-[var(--radius-control)] border p-3 text-sm ${mode === m.value ? "border-primary bg-primary-soft" : "border-line hover:bg-canvas"}`}>
                <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-0.5" />
                <span><span className="block font-semibold">{m.label}</span><span className="text-xs text-muted">{m.hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {mode === "ONE_ROOM" && dept && (
          <F label="Room" className="mt-4 max-w-md">
            <select name="targetRoomId" required value={target} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")} className={ctl}>
              <option value="">Choose the room…</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
            </select>
          </F>
        )}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">3 · Preview</h2>
          {dept && <p className="text-sm text-muted">{dept.name}: {rooms.length} rooms, {bedTotal} beds</p>}
        </div>
        {!dept ? (
          <p className="p-4 text-sm text-muted">Choose a department to see where each unit goes.</p>
        ) : rooms.length === 0 ? (
          <p className="p-4 text-sm text-muted">{dept.name} has no rooms yet. Add rooms on the facility page, then come back.</p>
        ) : (
          <>
            {result.warnings.length > 0 && (
              <ul className="space-y-1 border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn" aria-live="polite">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            )}
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-[14px]">
                <thead className="sticky top-0 bg-sunken text-left text-[13px] text-muted"><tr>
                  <th className="px-4 py-2 font-semibold">Room</th><th className="px-4 py-2 font-semibold">Type</th><th className="px-4 py-2 text-right font-semibold">Beds</th>
                  <th className="px-4 py-2 text-right font-semibold">Units</th>
                </tr></thead>
                <tbody>
                  {rooms.map((r) => {
                    const c = countFor(r.id);
                    return (
                      <tr key={r.id} className={`border-t border-line ${c ? "" : "text-muted"}`}>
                        <td className="px-4 py-1.5"><span className="font-mono text-xs">{r.code}</span> <span className="ml-1">{r.name}</span></td>
                        <td className="px-4 py-1.5 text-xs">{humanize(r.type)}</td>
                        <td className="px-4 py-1.5 text-right">{r.beds || "—"}</td>
                        <td className="px-4 py-1.5 text-right">
                          {mode === "MANUAL" ? (
                            <input type="number" min={0} max={500} name={`count-${r.id}`} aria-label={`Units for ${r.code}`} value={manual[r.id] ?? ""}
                              onChange={(e) => setManual({ ...manual, [r.id]: Math.max(0, Number(e.target.value) || 0) })}
                              className="w-20 rounded-[var(--radius-control)] border border-line px-2 py-0.5 text-right" />
                          ) : c ? (
                            <span className="inline-flex items-center gap-1 font-semibold">
                              <span aria-hidden className="flex gap-0.5">{Array.from({ length: Math.min(c, 6) }, (_, i) => <span key={i} className="size-2 rounded-full bg-tag" />)}</span>{c}
                            </span>
                          ) : "0"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr className="border-t-2 border-line font-semibold"><td className="px-4 py-2" colSpan={3}>Total</td><td className="px-4 py-2 text-right">{result.total} of {quantity}</td></tr></tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={!dept || result.total === 0 || (mode === "MANUAL" && result.total !== quantity)}
          className="rounded-[var(--radius-control)] border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-strong disabled:opacity-50">
          {result.total ? `Create ${result.total} asset${result.total === 1 ? "" : "s"}` : "Create assets"}
        </button>
        <span className="text-sm text-muted">Each unit gets its own tag and appears on the floor map in its room.</span>
      </div>
    </ActionForm>
  );
}
