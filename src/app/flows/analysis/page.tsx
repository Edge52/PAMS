import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, facilities, floorCad, floors } from "@/db/schema";
import { Badge, Button, EmptyState, Field, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { Crumbs, NativeSelect } from "@/components/assets/bits";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { hospitalAnalysis } from "@/lib/flows/analysis-server";
import { readinessLine } from "@/lib/flows/readiness";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pathway analysis" };

const pct = (u: number | null) => (u == null ? "—" : `${Math.round(u * 100)} %`);
/** A figure with its formula on hover and focus (keyboard and touch users get it via the underline). */
function Est({ value, formula, flag }: { value: string; formula: string; flag?: boolean }) {
  return (
    <span tabIndex={0} title={formula} className={`cursor-help underline decoration-dotted underline-offset-2 ${flag ? "font-semibold text-danger" : ""}`}>{value}</span>
  );
}

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const scope = await facilityScope(me);
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  if (!facs.length) return (<><PageHeader title="Pathway analysis" /><EmptyState title="No hospital yet">Add a hospital first.</EmptyState></>);
  const withCad = await db.selectDistinct({ id: buildings.facilityId }).from(floorCad).innerJoin(floors, eq(floors.id, floorCad.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId));
  const wanted = Number(typeof sp.facilityId === "string" ? sp.facilityId : NaN);
  if (Number.isInteger(wanted) && wanted > 0) await requireFacilityAccess(wanted, me);
  const fac = facs.find((f) => f.id === wanted) ?? facs.find((f) => withCad.some((w) => w.id === f.id)) ?? facs[0];
  const a = await hospitalAnalysis(fac.id);
  const { load, beds, scanners, skipped } = a.analysis;
  const flags = load.filter((r) => r.flag).length + beds.filter((r) => r.flag).length + scanners.filter((r) => r.flag).length;
  const blocked = a.readiness.filter((r) => r.blocked);

  return (
    <>
      <Crumbs items={[{ label: "Patient pathways", href: `/flows?facilityId=${fac.id}` }, { label: "Analysis" }]} />
      <PageHeader
        title="Pathway analysis"
        description={`${fac.name} · every published pathway together. Estimates: hover or focus a figure to see how it's worked out.`}
        actions={a.flows.length ? <a href={`/flows/analysis/export?facilityId=${fac.id}`} download className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold hover:bg-canvas">Download Excel</a> : undefined}
      />
      {facs.length > 1 && (
        <form className="mb-4 flex items-end gap-2 print:hidden" action="/flows/analysis">
          <Field label="Hospital"><NativeSelect name="facilityId" value={fac.id} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      {!a.flows.length ? (
        <EmptyState title="No published pathways">Publish a pathway (Planning › Patient pathways) to see room load, beds, scanners and equipment readiness here.</EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm">
            {a.flows.length} pathway{a.flows.length === 1 ? "" : "s"}: {a.flows.map((f, i) => <span key={f.id}>{i ? ", " : ""}<Link href={`/flows/${f.id}`} className="text-primary hover:underline">{f.name}</Link> ({f.dailyVolume ?? "no"} a day)</span>)}.{" "}
            {flags ? <b className="text-danger">{flags} figure{flags === 1 ? "" : "s"} over the flag level.</b> : <span className="text-ok">Nothing over the flag levels.</span>}{" "}
            {blocked.length > 0 && <b className="text-danger">{blocked.length} pathway{blocked.length === 1 ? "" : "s"} missing working equipment.</b>}
          </p>

          <Panel title="Room load at the busiest hour">
            {load.length === 0 ? <p className="text-sm text-muted">No short-stay steps with minutes and a place.</p> : (
              <Table>
                <THead><tr><Th>Place</Th><Th>Steps</Th><Th align="right">Patients a day</Th><Th align="right">Busiest hour</Th><Th align="right">At once</Th><Th align="right">Rooms</Th><Th align="right">Load</Th></tr></THead>
                <tbody>{load.map((r, i) => (
                  <tr key={i}><Td className="font-semibold">{r.place}</Td><Td><span className="text-xs">{r.steps.join("; ")}</span></Td><Td align="right">{r.patientsPerDay}</Td>
                    <Td align="right">{String(r.peakHour).padStart(2, "0")}:00</Td><Td align="right">{r.atOncePeak}</Td><Td align="right">{r.rooms || "—"}</Td>
                    <Td align="right"><Est value={r.rooms ? pct(r.utilisation) : "No rooms"} formula={r.formula} flag={r.flag || !r.rooms} /></Td></tr>
                ))}</tbody>
              </Table>
            )}
            <p className="mt-2 text-xs text-muted">Flag above 85 %. A patient is counted at every step in the hour they arrive, so later steps&apos; peaks are approximate.</p>
          </Panel>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Panel title="Beds needed">
              {beds.length === 0 ? <p className="text-sm text-muted">No stays of 12 hours or more.</p> : (
                <Table>
                  <THead><tr><Th>Department</Th><Th align="right">Patients a day</Th><Th align="right">Beds needed</Th><Th align="right">Beds</Th></tr></THead>
                  <tbody>{beds.map((r, i) => (
                    <tr key={i}><Td className="font-semibold">{r.department}<span className="block text-xs font-normal text-muted">{r.steps.join("; ")}</span></Td><Td align="right">{r.patientsPerDay}</Td>
                      <Td align="right"><Est value={String(r.bedsNeeded)} formula={r.formula} flag={r.flag} /></Td><Td align="right">{r.beds}{r.source === "rooms" && <span className="block text-xs text-muted">bed rooms</span>}</Td></tr>
                  ))}</tbody>
                </Table>
              )}
              <p className="mt-2 text-xs text-muted">Only these pathways&apos; patients: other admissions use the same beds.</p>
            </Panel>
            <Panel title="Scanners">
              {scanners.length === 0 ? <p className="text-sm text-muted">No step needs a CT, MRI, X-ray or ultrasound scanner.</p> : (
                <Table>
                  <THead><tr><Th>Place</Th><Th align="right">Exams a year</Th><Th align="right">Devices</Th><Th align="right">Load</Th></tr></THead>
                  <tbody>{scanners.map((r, i) => (
                    <tr key={i}><Td className="font-semibold">{r.place} <span className="font-normal text-muted">{r.modality}</span></Td><Td align="right">{r.examsPerYear.toLocaleString("en")}</Td><Td align="right">{r.devices}</Td>
                      <Td align="right"><Est value={r.devices ? pct(r.utilisation) : "No scanner"} formula={r.formula} flag={r.flag} /></Td></tr>
                  ))}</tbody>
                </Table>
              )}
            </Panel>
          </div>

          <Panel title="Equipment readiness now" className="mt-5">
            <ul className="space-y-2 text-sm">
              {a.readiness.map((r) => (
                <li key={r.id}>
                  <Link href={`/flows/${r.id}`} className="font-semibold text-primary hover:underline">{r.name}</Link>{" "}
                  {r.total === 0 ? <span className="text-muted">no equipment listed</span> : <Badge tone={r.blocked ? "danger" : "ok"}>{r.blocked ? `${r.total - r.ok} of ${r.total} not met` : `all ${r.total} met`}</Badge>}
                  {r.rows.filter((x) => x.state !== "ok").length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-danger">{r.rows.filter((x) => x.state !== "ok").map((x, i) => <li key={i}>{readinessLine(x)}</li>)}</ul>}
                </li>
              ))}
            </ul>
          </Panel>

          <p className="mt-4 text-xs text-muted">Lift load, corridor traffic and side-by-side comparisons need walking routes: open the pathways in the <Link href={`/assets/3d?facilityId=${fac.id}`} className="text-primary hover:underline">3D view</Link>.{skipped.length ? ` Not counted: ${skipped.join("; ")}.` : ""}</p>
        </>
      )}
    </>
  );
}
