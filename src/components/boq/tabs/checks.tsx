import Link from "next/link";
import { Badge, Button, Panel, Table, Td, Th, THead } from "@/components/ui";
import { fitToBudgetAction } from "@/app/boq/actions";
import { PER_LABEL } from "@/lib/boq/benchmarks";
import { describeChange } from "@/lib/boq/fit-budget";
import type { BoqChecks } from "@/lib/boq/checks-server";
import type { RoomStandardsCheck } from "@/lib/boq/planning-server";
import type { ReqResult } from "@/lib/boq/room-requirements";
import { standardsTotals } from "@/lib/boq/room-standards-check";
import type { BoqWorkspace } from "@/lib/boq/queries";
import { formatMoney, formatNumber } from "@/lib/format";

const SEVERITY = { high: { tone: "danger", label: "High" }, medium: { tone: "warn", label: "Medium" }, low: { tone: "info", label: "Low" } } as const;

/** Checks: risk flags, fit to budget, and benchmarks against reference ranges. */
export function ChecksTab({ ws, checks, locked, rooms, standards }: { ws: BoqWorkspace; checks: BoqChecks; locked: boolean; rooms: ReqResult[]; standards: RoomStandardsCheck }) {
  const { boq } = ws;
  const money = (n: number) => formatMoney(n, boq.currency, { compact: Math.abs(n) >= 1e6 });
  const { fit, risks, benchmarks } = checks;
  const off = benchmarks.filter((b) => b.status !== "ok");
  const sorted = [...benchmarks].sort((a, b) => Number(a.status === "ok") - Number(b.status === "ok") || a.department.localeCompare(b.department));
  const dens = (v: number) => formatNumber(v, v < 1 ? 2 : 1);

  return (
    <div className="space-y-5">
      <Panel title="Risk flags" actions={<span className="text-xs text-muted">{risks.length ? `${risks.length} found` : "None found"}</span>}>
        {risks.length === 0 ? <p className="text-sm text-ok">No risks found: no single point of failure, critical areas equipped, within budget and every line priced.</p> : (
          <ul className="space-y-3">
            {risks.map((r) => (
              <li key={r.key} className="flex gap-3">
                <span className="pt-0.5"><Badge tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].label}</Badge></span>
                <div className="min-w-0"><p className="font-semibold">{r.title}</p><p className="text-sm text-muted">{r.detail}</p></div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Fit to budget" actions={fit ? <span className="text-xs text-muted">Target {money(fit.target)}</span> : undefined}>
        {checks.target == null ? (
          <p className="text-sm text-muted">No target budget yet. <Link href={`/boq/${boq.id}?tab=scope`} className="font-semibold text-primary hover:underline">Set one on the Departments tab</Link> to see how to bring the BOQ within it.</p>
        ) : !fit ? (
          <p className="text-sm text-warn">No exchange rate from USD to {boq.currency}, so the tier prices can&apos;t be worked out.</p>
        ) : fit.changes.length === 0 ? (
          <p className={`text-sm ${fit.reached ? "text-ok" : "text-warn"}`}>{fit.reached
            ? `Within the target: ${money(fit.before)} of ${money(fit.target)}.`
            : `${money(fit.before - fit.target)} over, and nothing left to cut: the rest is essential equipment or prices typed by hand (${money(fit.untouchable)}).`}</p>
        ) : (
          <>
            <p className="text-sm">
              Now <strong>{money(fit.before)}</strong>, {money(fit.before - fit.target)} over. These {fit.changes.length} changes bring it to <strong>{money(fit.after)}</strong>
              {fit.reached ? <span className="text-ok"> — within the target.</span> : <span className="text-warn"> — still {money(fit.after - fit.target)} over; the rest is essential equipment or prices typed by hand.</span>}
            </p>
            <p className="mt-1 text-xs text-muted">Optional items go first (biggest first), then recommended items move to a lower price tier. Essential items and prices typed by hand are never changed.</p>
            {(() => {
              const drops = fit.changes.filter((c) => c.kind === "drop"), tiers = fit.changes.filter((c) => c.kind === "tier");
              const sum = (cs: typeof fit.changes) => cs.reduce((t, c) => t + c.saving, 0);
              const biggest = [...fit.changes].sort((x, y) => y.saving - x.saving);
              const rows = (cs: typeof fit.changes) => (
                <Table className="mt-2">
                  <THead><tr><Th>Change</Th><Th align="right">Saving</Th></tr></THead>
                  <tbody>
                    {cs.map((c) => (
                      <tr key={`${c.kind}-${c.lineId}`}>
                        <Td><Badge tone={c.kind === "drop" ? "warn" : "info"}>{c.kind === "drop" ? "Drop" : "Lower tier"}</Badge> <span className="ml-1">{describeChange(c)}</span></Td>
                        <Td align="right">{money(c.saving)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              );
              return (
                <>
                  <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <li className="rounded-[var(--radius-panel)] border border-line px-3 py-2"><strong>{drops.length}</strong> optional items dropped · saves {money(sum(drops))}</li>
                    <li className="rounded-[var(--radius-panel)] border border-line px-3 py-2"><strong>{tiers.length}</strong> recommended lines to a lower price tier · saves {money(sum(tiers))}</li>
                  </ul>
                  <p className="mt-3 text-sm font-semibold">Biggest changes</p>
                  {rows(biggest.slice(0, 12))}
                  {biggest.length > 12 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-semibold text-primary">Show all {biggest.length} changes</summary>
                      {rows(biggest.slice(12))}
                    </details>
                  )}
                </>
              );
            })()}
            {!locked && (
              <form action={fitToBudgetAction} className="mt-3">
                <input type="hidden" name="boqId" value={boq.id} />
                <Button variant="primary">Apply these {fit.changes.length} changes</Button>
              </form>
            )}
          </>
        )}
      </Panel>

      <Panel title="Room requirements" actions={<span className="text-xs text-muted">{rooms.length ? `${rooms.filter((r) => r.status !== "ok").length} of ${rooms.length} need attention` : ""}</span>}>
        {rooms.length === 0 ? <p className="text-sm text-muted">No equipment in this BOQ needs a special room (CT, MRI, angiography, X-ray rooms, theatres).</p> : (
          <>
            <p className="mb-3 text-xs text-muted">Room areas come from the floor plans of the linked departments. Minimum areas follow published guidance where it exists (FGI, vendor site planning; see docs/reference-figures.md) — confirm with the chosen vendor&apos;s site planning guide.</p>
            <ul className="space-y-3">
              {rooms.map((r, i) => (
                <li key={`${r.device}-${r.department}-${i}`} className="rounded-[var(--radius-panel)] border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === "ok" ? "ok" : r.status === "short" ? "danger" : "warn"}>
                      {r.status === "ok" ? "Rooms fit" : r.status === "short" ? "Not enough room" : r.status === "no-rooms" ? "No rooms drawn" : "Not linked"}
                    </Badge>
                    <span className="font-semibold">{r.quantity} × {r.device}</span><span className="text-sm text-muted">· {r.department}</span>
                  </div>
                  <p className="mt-1 text-sm">
                    {r.status === "ok" && <>Fits in {r.fitting.map((f) => `${f.name} ${f.code} (${formatNumber(f.area, 1)} m²)`).join(", ")}; needs at least {r.need.minArea} m².</>}
                    {r.status === "short" && <>{r.fitting.length} of {r.quantity} fit. {r.largest ? <>The largest free room is {r.largest.name} {r.largest.code} at {formatNumber(r.largest.area, 1)} m²; </> : null}needs at least {r.need.minArea} m².</>}
                    {r.status === "no-rooms" && <>The linked department has no rooms on the floor plans yet. Needs at least {r.need.minArea} m².</>}
                    {r.status === "not-linked" && <>Link this BOQ department to a real department (Departments tab) to check it against the floor plans. Needs at least {r.need.minArea} m².</>}
                  </p>
                  <p className="mt-1 text-xs text-muted">{[r.need.shielding && `Shielding: ${r.need.shielding}`, r.need.power && `Power: ${r.need.power}`, r.need.hvac && `HVAC: ${r.need.hvac}`, r.need.floorLoad && `Floor load: ${r.need.floorLoad}`].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <RoomStandardsPanel boqId={boq.id} standards={standards} />

      <Panel title="Benchmarks" actions={<span className="text-xs text-muted">{benchmarks.length ? `${off.length} of ${benchmarks.length} outside the range` : ""}</span>}>
        {benchmarks.length === 0 ? <p className="text-sm text-muted">No benchmark applies to these departments yet (ICU, CCU, NICU, emergency, theatres, wards, delivery, dialysis and radiology are covered).</p> : (
          <>
            <p className="mb-3 text-xs text-muted">Reference ranges for a first check: sourced where a published figure exists, planning judgement otherwise (docs/reference-figures.md) — confirm them with your biomedical team. Planned quantity divided by the department&apos;s beds, rooms or the hospital&apos;s beds.</p>
            <Table>
              <THead><tr><Th>Department</Th><Th>Equipment</Th><Th align="right">Planned</Th><Th align="right">Density</Th><Th align="right">Range</Th><Th>Check</Th></tr></THead>
              <tbody>
                {sorted.map((b) => (
                  <tr key={`${b.departmentId}-${b.label}`}>
                    <Td>{b.department}</Td>
                    <Td>{b.label}</Td>
                    <Td align="right">{formatNumber(b.quantity)}</Td>
                    <Td align="right">{dens(b.value)} {PER_LABEL[b.per]}</Td>
                    <Td align="right" className="whitespace-nowrap text-muted">{dens(b.min)}–{dens(b.max)}</Td>
                    <Td><Badge tone={b.status === "ok" ? "ok" : b.status === "under" ? "warn" : "info"}>{b.status === "ok" ? "In range" : b.status === "under" ? "Below range" : "Above range"}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Panel>
    </div>
  );
}

const SHOW = 60;
const list = (xs: string[], n = 4) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", "));
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Room standards (wave 15): the linked departments' rooms against the standard for their kind of room. */
function RoomStandardsPanel({ boqId, standards }: { boqId: number; standards: RoomStandardsCheck }) {
  const { departments, equipment, unlinked } = standards;
  const gaps = equipment.reduce((t, d) => t + d.items.filter((i) => i.gap > 0).length, 0);
  const t = standardsTotals(departments);
  return (
    <Panel title="Room standards" actions={<span className="text-xs text-muted">{t.withStandard ? `${t.short} of ${t.withStandard} rooms below the standard` : ""}</span>}>
      {departments.length === 0 ? (
        <p className="text-sm text-muted">No BOQ department is linked to a real department yet. <Link href={`/boq/${boqId}?tab=scope`} className="font-semibold text-primary hover:underline">Link them on the Departments tab</Link> to check their rooms against the room standards.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">
            Each room of the linked departments against the <Link href="/facilities/room-standards" className="text-primary hover:underline">standard for its kind of room</Link>: area (per bed space), ceiling, door, floor load, power, medical gas outlets and shielding.
            Areas come from the drawings; the rest from the room survey (3D view › room › Will it fit › Edit survey). Draft figures: confirm with the engineers.
            {unlinked > 0 && ` ${unlinked} BOQ department${unlinked === 1 ? " is" : "s are"} not linked and not checked.`}
          </p>
          <ul className="mb-3 grid gap-2 text-sm sm:grid-cols-4">
            <li className="rounded-[var(--radius-panel)] border border-line px-3 py-2"><strong>{formatNumber(t.rooms)}</strong> rooms</li>
            <li className="rounded-[var(--radius-panel)] border border-line px-3 py-2"><strong className="text-ok">{formatNumber(t.ok)}</strong> meet the standard</li>
            <li className="rounded-[var(--radius-panel)] border border-line px-3 py-2"><strong className={t.short ? "text-danger" : ""}>{formatNumber(t.short)}</strong> below it</li>
            <li className="rounded-[var(--radius-panel)] border border-line px-3 py-2"><strong className={t.unknown ? "text-warn" : ""}>{formatNumber(t.unknown)}</strong> to survey</li>
          </ul>
          <Table>
            <THead><tr><Th>Department</Th><Th align="right">Rooms</Th><Th align="right">With a standard</Th><Th align="right">Meet it</Th><Th align="right">Below</Th><Th align="right">To survey</Th><Th>Most often short</Th></tr></THead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.boqDepartmentId}>
                  <Td>{d.department}</Td>
                  <Td align="right">{d.rooms || <span className="text-muted">none drawn</span>}</Td>
                  <Td align="right">{d.withStandard}</Td>
                  <Td align="right">{d.ok}</Td>
                  <Td align="right" className={d.short ? "font-semibold text-danger" : ""}>{d.short}</Td>
                  <Td align="right" className={d.unknown ? "text-warn" : ""}>{d.unknown}</Td>
                  <Td className="text-sm text-muted">{d.shortItems.length ? list(d.shortItems.map((x) => `${lower(x.label)} (${x.rooms})`), 3) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {equipment.length > 0 && (
            <details className="mt-3" open={gaps > 0 && gaps <= 12}>
              <summary className="cursor-pointer text-sm font-semibold text-primary">Room templates&apos; equipment against this BOQ ({gaps ? `${gaps} short` : "all covered"})</summary>
              <p className="mt-1 text-xs text-muted">What the room templates ask for in each department&apos;s drawn rooms (per bed space where the template says so) against the quantities in this BOQ. A BOQ line counts when its code is the template&apos;s code or under it.</p>
              <Table>
                <THead><tr><Th>Department</Th><Th>Equipment</Th><Th align="right">Rooms</Th><Th align="right">Templates need</Th><Th align="right">In the BOQ</Th><Th align="right">Short</Th></tr></THead>
                <tbody>{equipment.flatMap((d) => d.items.map((i, k) => (
                  <tr key={`${d.boqDepartmentId}-${i.code}`}>
                    <Td>{k === 0 ? d.department : ""}</Td>
                    <Td>{i.label} <span className="font-mono text-xs text-muted">{i.code}</span></Td>
                    <Td align="right">{i.rooms}</Td><Td align="right">{i.need}</Td><Td align="right">{i.planned}</Td>
                    <Td align="right" className={i.gap ? "font-semibold text-danger" : "text-ok"}>{i.gap || "—"}</Td>
                  </tr>
                )))}</tbody>
              </Table>
            </details>
          )}
          {departments.some((d) => d.shortRooms.length) && (
            <details className="mt-3" open={t.short <= 8}>
              <summary className="cursor-pointer text-sm font-semibold text-primary">Rooms below their standard ({t.short})</summary>
              {t.short > SHOW && <p className="mt-1 text-xs text-muted">The first {SHOW} are listed; each room&apos;s data sheet has the full check.</p>}
              <ul className="mt-2 space-y-1.5 text-sm">
                {departments.flatMap((d) => d.shortRooms).slice(0, SHOW).map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-2">
                    <Link href={`/facilities/${r.facilityId}/rooms/${r.id}/sheet`} className="font-semibold text-primary hover:underline">{r.name} {r.code}</Link>
                    <span className="text-muted">{r.floor} · {r.standard}</span>
                    <span><span className="text-danger">Short: {list(r.short.map(lower))}</span>{r.unknown.length ? <span className="text-muted"> · to survey: {list(r.unknown.map(lower), 3)}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {departments.some((d) => d.toSurvey.length) && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold text-primary">Rooms to survey ({t.unknown})</summary>
              <p className="mt-1 text-xs text-muted">Nothing measured is short, but these items are not surveyed yet.{t.unknown > SHOW ? ` The first ${SHOW} are listed.` : ""}</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {departments.flatMap((d) => d.toSurvey).slice(0, SHOW).map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-2">
                    <Link href={`/facilities/${r.facilityId}/rooms/${r.id}/sheet`} className="font-semibold text-primary hover:underline">{r.name} {r.code}</Link>
                    <span className="text-muted">{r.floor} · {list(r.unknown.map(lower), 5)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}
