import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Badge, Button, Input, PageHeader, Panel, Stat, Table, Td, Th, THead } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { CONFIDENCE_LABELS, confidenceLine, OUTLINE_LABELS, polyArea } from "@/lib/assets/drawing-quality";
import { facilityDrawingQuality } from "@/lib/assets/drawing-quality-server";
import { formatDate } from "@/lib/format";
import { setRevisionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Drawing quality" };

const GRADE = { good: { tone: "ok", label: "Good" }, fair: { tone: "warn", label: "Fair" }, poor: { tone: "danger", label: "Poor" } } as const;
const SYMBOL_KINDS: Record<string, string> = { equipment: "Equipment", furniture: "Furniture", sanitary: "Sanitary fittings", outlet: "Gas outlets and bed-heads" };
const SEV = { high: { tone: "danger", label: "High" }, medium: { tone: "warn", label: "Medium" }, low: { tone: "info", label: "Low" } } as const;

/**
 * Drawing quality (wave 16, 3D roadmap phase 1): every floor's drawing checked — layers found, how each room outline was
 * made, overlaps, scale, alignment, age, rooms no door leads to — with a score per floor and where each room came from.
 */
export default async function DrawingQualityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [fac] = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.id, Number(id)));
  if (!fac) notFound();
  await requireFacilityAccess(fac.id, me);
  const canEdit = can(me.role, "facilities.edit");
  const { floors, reports } = await facilityDrawingQuality(fac.id);
  const rooms = reports.reduce((t, r) => t + r.rooms, 0);
  const total = (k: "verified" | "drawing" | "assumed") => reports.reduce((t, r) => t + r.byConfidence[k], 0);
  const weighted = rooms ? Math.round(reports.reduce((t, r) => t + r.score * r.rooms, 0) / rooms) : null;
  const roomName = new Map(floors.flatMap((f) => f.rooms.map((r) => [r.id, r] as const)));
  const ordered = [...reports].sort((a, b) => b.level - a.level);

  return (
    <>
      <PageHeader title="Drawing quality" description={`${fac.name} · how far the 3D model can be trusted, floor by floor, and where each room came from`}
        back={{ href: `/facilities/${fac.id}`, label: fac.name }} />
      <Notice sp={sp} />
      {!floors.length ? <p className="text-sm text-muted">No floors yet.</p> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Overall score" value={weighted ?? "—"} hint="out of 100, weighted by rooms" />
            <Stat label="From the drawing" value={total("drawing").toLocaleString()} hint="rooms closed by walls" />
            <Stat label="Assumed" value={total("assumed").toLocaleString()} hint="split, guessed, drawn by hand or not recorded" />
            <Stat label="Verified on site" value={total("verified").toLocaleString()} hint="checked by someone on the floor" />
          </div>

          <Panel title="Floors">
            <Table>
              <THead><tr><Th>Floor</Th><Th align="right">Score</Th><Th align="right">Rooms</Th><Th>Rooms by confidence</Th><Th>Drawing</Th><Th align="right">Issues</Th></tr></THead>
              <tbody>{ordered.map((r) => {
                const f = floors.find((x) => x.id === r.floorId)!;
                return (
                  <tr key={r.floorId}>
                    <Td className="font-semibold"><a href={`#floor-${r.floorId}`} className="text-primary hover:underline">{r.name}</a></Td>
                    <Td align="right"><span className="mr-2 font-semibold">{r.score}</span><Badge tone={GRADE[r.grade].tone}>{GRADE[r.grade].label}</Badge></Td>
                    <Td align="right">{r.rooms}</Td>
                    <Td className="text-xs text-muted">{confidenceLine(r)}</Td>
                    <Td className="text-xs">{f.cad ? <>{f.cad.sourceFile ?? "—"}<span className="block text-muted">{f.cad.revision ? `${f.cad.revision} · ` : ""}imported {formatDate(f.cad.importedAt)}</span></> : <span className="text-muted">Drawn in the app</span>}</Td>
                    <Td align="right">{r.issues.length ? <span className={r.issues.some((i) => i.severity === "high") ? "font-semibold text-danger" : ""}>{r.issues.length}</span> : "—"}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
            <p className="mt-3 text-xs text-muted">
              A room is <b>from the drawing</b> when walls close it, <b>assumed</b> when its outline was split from an open area, guessed as a box around its label, drawn by hand or not recorded,
              and <b>verified</b> once someone checks it on site (room data sheet › Mark as verified). Re-importing a floor (Update drawings) records its sources; a changed outline loses its verified mark.
              In the 3D view, View › Drawing confidence colours the rooms the same way.
            </p>
          </Panel>

          {ordered.map((r) => {
            const f = floors.find((x) => x.id === r.floorId)!;
            return (
              <Panel key={r.floorId} title={<span id={`floor-${r.floorId}`}>{r.name} <span className="font-normal text-muted">· {r.score} / 100</span></span>}
                actions={<Link href={`/assets/3d?facilityId=${fac.id}`} className="text-sm text-primary hover:underline">3D view</Link>}>
                <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
                  <div>
                    {r.issues.length === 0 ? <p className="text-sm text-ok">No issues found on this floor.</p> : (
                      <ul className="space-y-3">{r.issues.map((i) => (
                        <li key={i.key} className="flex gap-3">
                          <span className="pt-0.5"><Badge tone={SEV[i.severity].tone}>{SEV[i.severity].label}</Badge></span>
                          <div className="min-w-0">
                            <p className="font-semibold">{i.title}</p>
                            <p className="text-sm text-muted">{i.detail}</p>
                            {i.roomIds && i.roomIds.length > 0 && (
                              <p className="mt-1 text-sm">{i.roomIds.slice(0, 12).map((rid, k) => { const rm = roomName.get(rid); return rm ? <span key={rid}>{k ? ", " : ""}<Link href={`/facilities/${fac.id}/rooms/${rid}/sheet`} className="text-primary hover:underline">{rm.name} {rm.code}</Link>{f.unitsPerMetre ? <span className="text-xs text-muted"> ({(polyArea(rm.poly) / f.unitsPerMetre ** 2).toFixed(1)} m²)</span> : null}</span> : null; })}
                                {i.roomIds.length > 12 && <span className="text-muted"> and {i.roomIds.length - 12} more</span>}</p>
                            )}
                          </div>
                        </li>
                      ))}</ul>
                    )}
                  </div>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted">Room outlines</p>
                      <ul className="space-y-0.5">{Object.entries(r.byOutline).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k} className="flex justify-between gap-2"><span>{OUTLINE_LABELS[k] ?? k}</span><span className="text-muted">{n}</span></li>)}</ul>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted">Confidence</p>
                      <ul className="space-y-0.5">{(["drawing", "assumed", "verified"] as const).map((k) => <li key={k} className="flex justify-between gap-2"><span>{CONFIDENCE_LABELS[k]}</span><span className="text-muted">{r.byConfidence[k]}</span></li>)}</ul>
                    </div>
                    {f.cad && (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-muted">Symbols read from the drawing</p>
                        {f.cad.symbols && Object.keys(f.cad.symbols).length ? (
                          <ul className="space-y-0.5">{Object.entries(f.cad.symbols).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k} className="flex justify-between gap-2"><span>{SYMBOL_KINDS[k] ?? k}</span><span className="text-muted">{n}</span></li>)}</ul>
                        ) : <p className="text-xs text-muted">None: re-import with the phase 2 reader to read equipment, fittings and gas outlets from block names.</p>}
                        {f.cad.drawing?.unmatched?.length ? <p className="mt-1 text-xs text-muted">Not recognised: {f.cad.drawing.unmatched.slice(0, 8).map((u) => `${u.name} ×${u.n}`).join(", ")}{f.cad.drawing.unmatched.length > 8 ? "…" : ""}</p> : null}
                      </div>
                    )}
                    {f.cad && (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-muted">Drawing</p>
                        <p className="break-words">{f.cad.sourceFile ?? "Source file not recorded"}</p>
                        <p className="text-xs text-muted">Imported {formatDate(f.cad.importedAt)} · walls {f.cad.segments.walls.toLocaleString()}, doors {f.cad.segments.doors.toLocaleString()}, glazing {f.cad.segments.glass.toLocaleString()}, columns {f.cad.segments.columns.toLocaleString()} lines
                          {f.cad.alignment ? (f.cad.alignment.reference ? " · the reference floor" : f.cad.alignment.residualMm != null ? ` · aligned on ${f.cad.alignment.lifts} lifts, ${Math.round(f.cad.alignment.residualMm)} mm off` : " · not aligned") : ""}
                          {f.cad.drawing ? ` · read as ${f.cad.drawing.reader.toUpperCase()}${f.cad.drawing.drawingUnits ? ` in ${f.cad.drawing.drawingUnits}` : ""}` : ""}</p>
                        {canEdit ? (
                          <form action={setRevisionAction} className="mt-2 flex gap-2">
                            <input type="hidden" name="floorId" value={f.id} />
                            <Input name="revision" defaultValue={f.cad.revision ?? ""} placeholder="Revision, e.g. Rev C 2026-05" maxLength={80} aria-label={`Drawing revision of ${f.name}`} />
                            <Button variant="secondary">Save</Button>
                          </form>
                        ) : f.cad.revision ? <p className="text-xs">Revision {f.cad.revision}</p> : null}
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
