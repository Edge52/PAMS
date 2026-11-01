import Link from "next/link";
import { Badge, Button, Panel, Table, Td, Th, THead } from "@/components/ui";
import { fitToBudgetAction } from "@/app/boq/actions";
import { PER_LABEL } from "@/lib/boq/benchmarks";
import { describeChange } from "@/lib/boq/fit-budget";
import type { BoqChecks } from "@/lib/boq/checks-server";
import type { ReqResult } from "@/lib/boq/room-requirements";
import type { BoqWorkspace } from "@/lib/boq/queries";
import { formatMoney, formatNumber } from "@/lib/format";

const SEVERITY = { high: { tone: "danger", label: "High" }, medium: { tone: "warn", label: "Medium" }, low: { tone: "info", label: "Low" } } as const;

/** Checks: risk flags, fit to budget, and benchmarks against reference ranges. */
export function ChecksTab({ ws, checks, locked, rooms }: { ws: BoqWorkspace; checks: BoqChecks; locked: boolean; rooms: ReqResult[] }) {
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
