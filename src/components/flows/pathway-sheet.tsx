/**
 * Printable pathway sheet (wave 8, A2): one A4 landscape page per pathway — diagram, steps, legs with their walking
 * routes, equipment readiness, checks and assumptions. Used on its own (/flows/[id]/sheet) and in the pathway book.
 */
import { FlowDiagram, fmtMin } from "./flow-diagram";
import { formatDate } from "@/lib/format";
import { FLOW_KIND_LABELS, stepVolumes, TRANSPORT_LABELS, type Issue, type Link, type Step } from "@/lib/flows/model";
import { readinessLine, type Readiness } from "@/lib/flows/readiness";
import { pathwayCard } from "@/components/assets/twin/pathways";
import { formatDuration, type Route } from "@/components/assets/twin/nav/route";

export type SheetData = {
  flow: { id: number; name: string; version: number; status: string; kind: keyof typeof FLOW_KIND_LABELS; dailyVolume: number | null; description: string | null; ownerName: string | null; publishedAt: Date | null; arrivalProfile: number[] | null };
  facility: string;
  steps: (Step & { x?: number | null; y?: number | null })[];
  links: (Link & { id: number })[];
  routes: (Route | null)[];
  placeOf: Record<string, string | null>;
  readiness: Readiness;
  issues: Issue[];
};

export function PathwaySheet({ d }: { d: SheetData }) {
  const vol = d.flow.dailyVolume ? stepVolumes(d.steps, d.links, d.flow.dailyVolume) : null;
  const card = pathwayCard({ id: d.flow.id, name: d.flow.name, version: d.flow.version, dailyVolume: d.flow.dailyVolume, steps: d.steps, links: d.links }, d.routes);
  const label = (k: string) => d.steps.find((s) => s.key === k)?.label ?? k;
  const peak = d.flow.arrivalProfile?.length === 24 ? d.flow.arrivalProfile.indexOf(Math.max(...d.flow.arrivalProfile)) : null;
  const care = card.careMinutes >= 2880 ? `${(card.careMinutes / 1440).toFixed(1)} days` : card.careMinutes >= 120 ? `${Math.round(card.careMinutes / 60)} h` : `${Math.round(card.careMinutes)} min`;
  return (
    <section className="pathway-sheet mb-8 rounded border border-line bg-surface p-5 text-sm print:mb-0 print:border-0 print:p-0">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-2">
        <div>
          <h2 className="text-lg font-bold">{d.flow.name} <span className="font-normal text-muted">v{d.flow.version}</span></h2>
          <p className="text-xs text-muted">{d.facility} · {FLOW_KIND_LABELS[d.flow.kind]} pathway · {d.flow.status === "PUBLISHED" ? `published ${d.flow.publishedAt ? formatDate(d.flow.publishedAt) : ""}` : d.flow.status.toLowerCase()}{d.flow.ownerName ? ` · owner ${d.flow.ownerName}` : ""}</p>
        </div>
        <p className="text-right text-xs">
          {d.flow.dailyVolume != null ? <><b>{d.flow.dailyVolume}</b> patients a day{peak != null ? `, busiest ${String(peak).padStart(2, "0")}:00` : ""}<br /></> : null}
          Per patient: <b>{Math.round(card.metres)} m</b> walked · {formatDuration(card.moveSeconds)} moving · {care} in care · {card.liftTrips.toFixed(1)} lift trips
        </p>
      </header>
      <div className="mb-3 overflow-hidden"><FlowDiagram steps={d.steps} links={d.links} volumes={vol} placeOf={(s) => d.placeOf[s.key] ?? null} problems={new Set(d.issues.filter((i) => i.stepKey).map((i) => i.stepKey!))} /></div>
      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
        <table className="w-full border-collapse text-xs">
          <thead><tr className="border-b border-line text-left"><th className="py-1">Step</th><th>Place</th><th className="text-right">Time</th><th className="text-right">A day</th><th>With · equipment</th></tr></thead>
          <tbody>{d.steps.map((s) => (
            <tr key={s.key} className="border-b border-line/60 align-top">
              <td className="py-1 font-semibold">{s.label}</td><td>{d.placeOf[s.key] ?? "—"}</td>
              <td className="text-right">{s.minutes ? fmtMin(s.minutes) : "—"}</td><td className="text-right">{vol ? Math.round((vol.get(s.key) ?? 0) * 10) / 10 : "—"}</td>
              <td>{[s.accompanying, s.equipment.join(", ")].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
          ))}</tbody>
        </table>
        <table className="w-full border-collapse text-xs">
          <thead><tr className="border-b border-line text-left"><th className="py-1">Leg</th><th className="text-right">Share</th><th>How</th><th className="text-right">Route</th></tr></thead>
          <tbody>{d.links.map((l, i) => {
            const r = d.routes[i];
            const lifts = r?.legs.filter((x) => x.kind !== "walk").map((x) => x.via).filter(Boolean).join(", ");
            return (
              <tr key={l.id} className="border-b border-line/60 align-top">
                <td className="py-1">{label(l.fromKey)} → {label(l.toKey)}{l.condition ? <span className="text-muted"> ({l.condition})</span> : null}</td>
                <td className="text-right">{l.share} %</td><td>{TRANSPORT_LABELS[l.transport]}{l.urgency === "URGENT" ? ", urgent" : ""}</td>
                <td className="text-right">{r ? `${Math.round(r.metres)} m · ${formatDuration(r.seconds)}${lifts ? ` · ${lifts}` : ""}${r.estimated ? " · est." : ""}` : "no route"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <div className="mt-3 grid gap-4 text-xs md:grid-cols-2 print:grid-cols-2">
        <div>
          <p className="font-semibold">Equipment readiness {d.readiness.total ? `(${d.readiness.ok} of ${d.readiness.total} ready)` : ""}</p>
          {d.readiness.total === 0 ? <p className="text-muted">No equipment listed.</p> : (
            <ul className="mt-0.5 space-y-0.5">{d.readiness.rows.filter((r) => r.state !== "ok").map((r, i) => <li key={i} className="text-danger">{readinessLine(r)}</li>)}
              {d.readiness.rows.every((r) => r.state === "ok") && <li className="text-ok">All needs met as of {formatDate(new Date())}.</li>}</ul>
          )}
        </div>
        <div>
          <p className="font-semibold">Checks</p>
          {d.issues.length === 0 ? <p className="text-ok">All checks pass.</p> : <ul className="mt-0.5 space-y-0.5">{d.issues.slice(0, 8).map((i, n) => <li key={n} className={i.level === "error" ? "text-danger" : "text-warn"}>{i.message}</li>)}{d.issues.length > 8 && <li className="text-muted">and {d.issues.length - 8} more</li>}</ul>}
        </div>
      </div>
      {d.flow.description && <p className="mt-3 text-xs text-muted"><b>Assumptions:</b> {d.flow.description}</p>}
      <p className="mt-1 text-[10px] text-muted">Distances and times are estimates from the drawings: walking pace by transport, lift waits as declared. Printed {formatDate(new Date())}.</p>
    </section>
  );
}
