"use client";
/**
 * Queue simulation extras (wave 15): staff on duty, opening hours, appointment books and, for the what-if, moving a
 * step to another floor. Each editor changes the page's one settings object (SimScenario).
 */
import { useState } from "react";
import { Button } from "@/components/ui";
import type { SimScenario } from "@/lib/flows/scenarios";
import type { OpeningHours, SimModel } from "@/lib/flows/simulate";
import { STAFFED_KINDS } from "@/lib/flows/simulate-model";

type Set = (f: (s: SimScenario) => SimScenario) => void;
const input = "h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
const HALF_HOURS = Array.from({ length: 49 }, (_, i) => i / 2);
const t = (x: number) => `${String(Math.floor(x)).padStart(2, "0")}:${x % 1 ? "30" : "00"}`;
const intOf = (v: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(v.replace(/[^\d]/g, "")) || 0)));

function Hour({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return <select aria-label={label} className={input} value={value} onChange={(e) => onChange(Number(e.target.value))}>{HALF_HOURS.map((h) => <option key={h} value={h}>{t(h)}</option>)}</select>;
}
function Remove({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} aria-label={label} className="text-sm text-danger hover:underline">Remove</button>;
}
function Box({ title, hint, children, count }: { title: string; hint: string; children: React.ReactNode; count: number }) {
  return (
    <details className="rounded-[var(--radius-panel)] border border-line bg-surface p-3" open={count > 0}>
      <summary className="cursor-pointer text-sm font-semibold">{title}{count > 0 && <span className="ml-2 font-normal text-muted">({count})</span>}</summary>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

/** Staff other than porters: a group, how many are on duty, and which rooms and scanners they work. */
export function StaffEditor({ model, s, set }: { model: SimModel; s: SimScenario; set: Set }) {
  const workable = model.resources.filter((r) => (STAFFED_KINDS as readonly string[]).includes(r.kind));
  const edit = (i: number, f: (g: SimScenario["staff"][number]) => SimScenario["staff"][number]) => set((x) => ({ ...x, staff: x.staff.map((g, j) => (j === i ? f(g) : g)) }));
  return (
    <Box title="Staff on duty" count={s.staff.length} hint="Radiographers, sonographers, nurses… A step in a room or scanner they work holds one of them for its minutes as well as the room, so too few staff make a queue even with rooms free. Change the number in the What-if column to compare.">
      {s.staff.map((g, i) => (
        <div key={i} className="rounded border border-line/70 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Staff group" className={`${input} w-48`} value={g.label} placeholder="e.g. Radiographers" maxLength={60} onChange={(e) => edit(i, (x) => ({ ...x, label: e.target.value }))} />
            <label className="text-sm text-muted">on duty <input aria-label={`${g.label || "Staff"} on duty`} className={`${input} w-16`} inputMode="numeric" value={g.count} onChange={(e) => edit(i, (x) => ({ ...x, count: intOf(e.target.value, 500) }))} /></label>
            <Remove label={`Remove ${g.label || "staff group"}`} onClick={() => set((x) => ({ ...x, staff: x.staff.filter((_, j) => j !== i) }))} />
          </div>
          <fieldset className="mt-2">
            <legend className="text-xs text-muted">Work{g.uses.length ? ` (${g.uses.length} chosen)` : ": choose at least one"}</legend>
            <div className="mt-1 grid max-h-40 gap-x-4 overflow-y-auto sm:grid-cols-2">
              {workable.map((r) => (
                <label key={r.key} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={g.uses.includes(r.key)} onChange={(e) => edit(i, (x) => ({ ...x, uses: e.target.checked ? [...x.uses, r.key] : x.uses.filter((u) => u !== r.key) }))} />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ))}
      {workable.length === 0 ? <p className="text-sm text-muted">No pathway step uses a room or scanner, so there is nothing for staff to work.</p>
        : <Button type="button" variant="secondary" onClick={() => set((x) => ({ ...x, staff: [...x.staff, { key: "", label: "", count: 2, uses: [] }] }))}>Add a staff group</Button>}
    </Box>
  );
}

/** Opening hours per room, scanner or staff group, with other hours for the what-if. */
export function HoursEditor({ model, s, set }: { model: SimModel; s: SimScenario; set: Set }) {
  const openable = model.resources.filter((r) => r.kind !== "bed" && r.kind !== "lift");
  const [adding, setAdding] = useState("");
  const keys = [...new Set([...Object.keys(s.hours), ...Object.keys(s.whatIf.hours)])].filter((k) => openable.some((r) => r.key === k));
  const all: OpeningHours = { open: 0, close: 24, weekends: true };
  const base = (k: string) => s.hours[k] ?? all;
  const setBase = (k: string, h: OpeningHours) => set((x) => ({ ...x, hours: { ...x.hours, [k]: h } }));
  const setWhat = (k: string, h: OpeningHours | undefined) => set((x) => { const w = { ...x.whatIf.hours }; if (h) w[k] = h; else delete w[k]; return { ...x, whatIf: { ...x.whatIf, hours: w } }; });
  const remove = (k: string) => set((x) => { const h = { ...x.hours }, w = { ...x.whatIf.hours }; delete h[k]; delete w[k]; return { ...x, hours: h, whatIf: { ...x.whatIf, hours: w } }; });
  const left = openable.filter((r) => !keys.includes(r.key));
  return (
    <Box title="Opening hours" count={keys.length} hint="A room, scanner or staff group that isn't open all day: patients who need it while it's closed wait until it opens; jobs under way finish. Busy shares are of the open hours. Everything not listed is open all day.">
      {keys.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-2">Resource</th><th className="pr-2">Open</th><th className="pr-2">Close</th><th className="pr-2">Weekdays only</th><th className="pr-2">What-if</th><th /></tr></thead>
            <tbody>{keys.map((k) => {
              const r = openable.find((x) => x.key === k)!, h = base(k), w = s.whatIf.hours[k];
              return (
                <tr key={k} className="border-t border-line/60 align-top">
                  <td className="py-1.5 pr-2">{r.label}</td>
                  <td className="pr-2"><Hour label={`${r.label} opens`} value={h.open} onChange={(v) => setBase(k, { ...h, open: v })} /></td>
                  <td className="pr-2"><Hour label={`${r.label} closes`} value={h.close} onChange={(v) => setBase(k, { ...h, close: v })} /></td>
                  <td className="pr-2"><input type="checkbox" aria-label={`${r.label} weekdays only`} checked={!h.weekends} onChange={(e) => setBase(k, { ...h, weekends: !e.target.checked })} /></td>
                  <td className="pr-2">
                    <select aria-label={`What-if hours for ${r.label}`} className={input} value={w ? "other" : "same"} onChange={(e) => setWhat(k, e.target.value === "other" ? { ...h } : undefined)}>
                      <option value="same">Same hours</option><option value="other">Other hours</option>
                    </select>
                    {w && (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <Hour label={`What-if: ${r.label} opens`} value={w.open} onChange={(v) => setWhat(k, { ...w, open: v })} />
                        <span className="text-muted">to</span>
                        <Hour label={`What-if: ${r.label} closes`} value={w.close} onChange={(v) => setWhat(k, { ...w, close: v })} />
                        <label className="text-xs text-muted"><input type="checkbox" checked={!w.weekends} onChange={(e) => setWhat(k, { ...w, weekends: !e.target.checked })} /> weekdays only</label>
                      </span>
                    )}
                  </td>
                  <td><Remove label={`Remove hours for ${r.label}`} onClick={() => remove(k)} /></td>
                </tr>
              );
            })}</tbody>
          </table>
          {keys.some((k) => base(k).close <= base(k).open) && <p className="text-xs text-warn">Closing must come after opening; a row with closing at or before opening counts as open all day.</p>}
        </div>
      )}
      {left.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Resource to set hours for" className={input} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Choose a room, scanner or staff group…</option>
            {left.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <Button type="button" variant="secondary" disabled={!adding} onClick={() => { setBase(adding, { open: 8, close: 20, weekends: false }); setAdding(""); }}>Set opening hours</Button>
        </div>
      )}
    </Box>
  );
}

/** Appointment books: a pathway's patients come at booked times through a session instead of at random. */
export function BooksEditor({ model, s, set }: { model: SimModel; s: SimScenario; set: Set }) {
  const [adding, setAdding] = useState("");
  const rows = Object.entries(s.books).filter(([id]) => model.flows.some((f) => f.id === Number(id)));
  const edit = (id: string, b: SimScenario["books"][string]) => set((x) => ({ ...x, books: { ...x.books, [id]: b } }));
  const left = model.flows.filter((f) => !(String(f.id) in s.books));
  return (
    <Box title="Appointment books" count={rows.length} hint="Booked patients come at their slot times (a few minutes early or late) spread evenly through the session, instead of at random by the hourly profile. The no-show share don't come. The patients a day setting still decides how many are booked.">
      {rows.map(([id, b]) => {
        const f = model.flows.find((x) => x.id === Number(id))!;
        const n = Math.round(f.perDay * (s.volume / 100)), slot = b.to > b.from && n ? ((b.to - b.from) * 60) / n : 0;
        return (
          <div key={id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-40 font-semibold">{f.name}</span>
            <span className="text-muted">from</span><Hour label={`${f.name} book opens`} value={b.from} onChange={(v) => edit(id, { ...b, from: v })} />
            <span className="text-muted">to</span><Hour label={`${f.name} book closes`} value={b.to} onChange={(v) => edit(id, { ...b, to: v })} />
            <label className="text-muted">no-shows, % <input aria-label={`${f.name} no-shows, %`} className={`${input} w-14`} inputMode="numeric" value={Math.round(b.noShow * 100)} onChange={(e) => edit(id, { ...b, noShow: intOf(e.target.value, 90) / 100 })} /></label>
            <span className="text-xs text-muted">{b.to > b.from ? `${n} booked, one every ${slot >= 1 ? Math.round(slot) : "<1"} min` : "Closing must come after opening"}</span>
            <Remove label={`Remove the book for ${f.name}`} onClick={() => set((x) => { const bs = { ...x.books }; delete bs[id]; return { ...x, books: bs }; })} />
          </div>
        );
      })}
      {left.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Pathway to book" className={input} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Choose a pathway…</option>
            {left.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <Button type="button" variant="secondary" disabled={!adding} onClick={() => { edit(adding, { from: 8, to: 16, noShow: 0.1 }); setAdding(""); }}>Book its patients</Button>
        </div>
      )}
    </Box>
  );
}

/** What-if: a step moved to another floor. Its lift trips change; it keeps its room, staff and times. */
export function MovesEditor({ model, s, set, floors }: { model: SimModel; s: SimScenario; set: Set; floors: { level: number; name: string }[] }) {
  const [step, setStep] = useState("");
  const floorName = (lv: number | null) => (lv == null ? "no floor" : floors.find((f) => f.level === lv)?.name ?? `level ${lv}`);
  const rows = Object.entries(s.whatIf.moves);
  const find = (k: string) => { const i = k.indexOf(":"); const f = model.flows.find((x) => x.id === Number(k.slice(0, i))); return { f, st: f?.steps.find((x) => x.key === k.slice(i + 1)) }; };
  const setMove = (k: string, lv: number) => set((x) => ({ ...x, whatIf: { ...x.whatIf, moves: { ...x.whatIf.moves, [k]: lv } } }));
  return (
    <Box title="What-if: move a step to another floor" count={rows.length} hint="Only the lift trips and porter rides to and from the step change: it keeps its room, staff and times. Use it to see what bringing a service nearer, or sending it upstairs, does to the lifts and the time in the pathway.">
      {rows.map(([k, lv]) => {
        const { f, st } = find(k); if (!f || !st) return null;
        return (
          <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{st.label}</span><span className="text-muted">({f.name}), now on {floorName(st.level)}, to</span>
            <select aria-label={`Floor for ${st.label}`} className={input} value={lv} onChange={(e) => setMove(k, Number(e.target.value))}>
              {floors.map((fl) => <option key={fl.level} value={fl.level}>{fl.name}</option>)}
            </select>
            <Remove label={`Remove the move of ${st.label}`} onClick={() => set((x) => { const m = { ...x.whatIf.moves }; delete m[k]; return { ...x, whatIf: { ...x.whatIf, moves: m } }; })} />
          </div>
        );
      })}
      {floors.length < 2 ? <p className="text-sm text-muted">This hospital has one floor, so there is nowhere to move a step.</p> : (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Step to move" className={input} value={step} onChange={(e) => setStep(e.target.value)}>
            <option value="">Choose a step…</option>
            {model.flows.map((f) => (
              <optgroup key={f.id} label={f.name}>
                {f.steps.filter((x) => x.kind === "STEP" && !(`${f.id}:${x.key}` in s.whatIf.moves)).map((x) => <option key={x.key} value={`${f.id}:${x.key}`}>{x.label} ({floorName(x.level)})</option>)}
              </optgroup>
            ))}
          </select>
          <Button type="button" variant="secondary" disabled={!step} onClick={() => {
            const { st } = find(step); const other = floors.find((fl) => fl.level !== st?.level) ?? floors[0];
            setMove(step, other.level); setStep("");
          }}>Move it</Button>
        </div>
      )}
    </Box>
  );
}

