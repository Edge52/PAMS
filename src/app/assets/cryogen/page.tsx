import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Button, EmptyState, Field, PageHeader, Panel, Stat } from "@/components/ui";
import { Sparkline } from "@/components/ui/charts";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect } from "@/components/assets/bits";
import { CryoBadges, CryoReadingForm } from "@/components/assets/cryogen-panel";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { mriMagnetRows } from "@/lib/assets/cryogen-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "MRI cryogen log" };

/** MRI cryogen log (wave 38): every MRI magnet's helium level, trend and warnings, and a form to record a reading. */
export default async function CryogenPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined);
  const today = todayISO();
  const [facs, rows] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)),
    mriMagnetRows({ scope, facilityId }, today),
  ]);
  const helium = rows.filter((r) => r.settings.cryogenic);
  const warn = helium.filter((r) => r.status.warnings.length);
  const low = helium.filter((r) => r.status.warnings.some((w) => w.kind === "low"));
  const missing = helium.filter((r) => r.status.warnings.some((w) => w.kind === "missing"));
  const canRecord = can(me.role, "maintenance.edit");

  return (
    <>
      <PageHeader title="MRI cryogen log" description="Helium level, pressure, cold head, compressor and chiller readings of each MRI magnet, with warnings when the level is low, falls too fast or has not been read. Change a magnet's warning levels on its own page." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="MRI scanners" value={formatNumber(rows.length)} hint={rows.length !== helium.length ? `${rows.length - helium.length} without helium` : undefined} />
        <Stat label="With a warning" value={formatNumber(warn.length)} />
        <Stat label="Helium low" value={formatNumber(low.length)} />
        <Stat label="Reading missing" value={formatNumber(missing.length)} />
      </div>
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId ?? ""} placeholder="Every hospital" options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      {rows.length === 0 ? <EmptyState title="No MRI scanners registered">MRI scanners appear here once they are in the asset register.</EmptyState> : (
        <div className="grid gap-6 xl:grid-cols-[1fr_26rem] [&>*]:min-w-0">
          <Panel title="Magnets" padded={false}>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="MRI magnets"><table className="w-full text-[13px]">
              <thead className="bg-sunken text-left text-muted"><tr>
                {["Scanner", "Helium", "Trend (120 days)", "Last reading", "Falling a month", "State"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>{rows.map((r) => {
                const s = r.status;
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-3 py-2"><Link href={`/assets/${r.id}#cryogen`} className="whitespace-nowrap font-mono text-primary hover:underline">{r.tag}</Link>
                      <div className="text-xs text-muted">{r.typeName}{r.roomName ? ` · ${r.roomName}` : ""}</div></td>
                    <td className={`px-3 py-2 font-semibold ${s.latest && s.latest.heliumPct < r.settings.heliumMinPct ? "text-danger" : ""}`}>{r.settings.cryogenic && s.latest ? `${formatNumber(s.latest.heliumPct, 1)} %` : "—"}
                      {r.settings.cryogenic && <div className="text-xs font-normal text-muted">minimum {r.settings.heliumMinPct} %</div>}</td>
                    <td className="px-3 py-2">{r.settings.cryogenic && r.readings.length > 1 ? <Sparkline values={r.readings.map((x) => x.heliumPct)} label={`${r.tag} helium %`} /> : "—"}</td>
                    <td className="px-3 py-2">{s.latest ? <>{formatDate(s.latest.readOn)}<div className="text-xs text-muted">{s.daysSinceReading === 0 ? "today" : s.daysSinceReading === 1 ? "yesterday" : `${s.daysSinceReading} days ago`}</div></> : "never"}</td>
                    <td className="px-3 py-2">{s.ratePer30 != null ? `${formatNumber(Math.max(0, s.ratePer30), 2)} points` : "—"}{s.reachesMinOn && <div className="text-xs text-muted">minimum about {formatDate(s.reachesMinOn)}</div>}</td>
                    <td className="px-3 py-2"><CryoBadges s={s} cryogenic={r.settings.cryogenic} /></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </Panel>
          {canRecord && helium.length > 0 && (
            <Panel title="Record a reading">
              <CryoReadingForm magnets={helium.map((m) => ({ id: m.id, tag: m.tag, typeName: m.typeName }))} />
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
