import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Badge, Button, EmptyState, PageHeader, Panel, Stat, TabLinks } from "@/components/ui";
import { AutoSubmit } from "@/components/auto-submit";
import { Meter, NativeSelect, Notice } from "@/components/assets/bits";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { byReplacement, replacementKey, TUBE_COUNTER_LABELS, TUBE_STATE_LABELS, TUBE_STATE_TONE, TUBE_WARN_WEEKS, type TubeCounter } from "@/lib/assets/tubes";
import { tubeList, type TubeListRow } from "@/lib/assets/tubes-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney, formatNumber, num, todayISO } from "@/lib/format";
import { sortRows } from "@/lib/list";
import { pageRows } from "@/lib/paging";

export const dynamic = "force-dynamic";
export const metadata = { title: "X-ray tubes" };

const SORT_KEYS = ["scanner", "installed", "life", "replace", "warranty", "cost"] as const;
const unitOf = (t: TubeListRow) => (TUBE_COUNTER_LABELS[t.counterUnit as TubeCounter] ?? t.counterUnit).toLowerCase();

/**
 * X-ray and CT tubes across the scanners in scope (wave 43): use against the expected life, the forecast replacement
 * and the warranty, from the same forecast as the device page (src/lib/assets/tubes.ts). Soonest replacement first.
 * Tubes are fitted and read on the device's own page.
 */
export default async function TubesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const removed = one("tab") === "removed";
  const facilityId = scopedFacilityId(scope, Number(one("facilityId")) || null);
  const today = todayISO();
  const showCost = can(me.role, "prices.view");
  const [facs, list] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)),
    tubeList(scope, today, { facilityId, removed }),
  ]);
  const sort = tableSort(sp, SORT_KEYS, null);
  const sorted = sort ? sortRows(list, sort, {
    scanner: (r) => r.tag, installed: (r) => r.installedOn, life: (r) => r.forecast.lifeUsed, replace: (r) => replacementKey(r.forecast),
    warranty: (r) => r.forecast.warrantyEnd, cost: (r) => (r.cost == null ? null : num(r.cost)),
  }) : byReplacement(list);
  const { rows, paging } = pageRows(sorted, sp);
  const count = (s: string) => list.filter((t) => t.forecast.state === s).length;
  const q = (tab: string) => `/assets/tubes?tab=${tab}${facilityId ? `&facilityId=${facilityId}` : ""}`;
  const columns = COLUMNS.filter((c) => showCost || c.key !== "cost");

  return (
    <>
      <PageHeader title="X-ray tubes" description="Tubes on CT, X-ray, mammography and angiography devices: use against the expected life, the forecast replacement date and the warranty. Fit a tube or enter a counter reading on the device's page." />
      <Notice sp={sp} />
      {!removed && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Tubes in use" value={formatNumber(list.length)} />
          <Stat label="Past expected life" value={formatNumber(count("over_life"))} />
          <Stat label={`Replace within ${TUBE_WARN_WEEKS} weeks`} value={formatNumber(count("replace_soon"))} />
          <Stat label="Warranty ending or over" value={formatNumber(count("warranty_ending") + count("out_of_warranty"))} hint={`${formatNumber(count("no_readings"))} with no readings`} />
        </div>
      )}
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <AutoSubmit />
          <input type="hidden" name="tab" value={removed ? "removed" : "in-use"} />
          <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} placeholder="All hospitals" options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>
          <Button variant="secondary">Filter</Button>
        </form>
      )}
      <TabLinks active={removed ? "removed" : "in-use"} tabs={[{ key: "in-use", label: "In use", href: q("in-use") }, { key: "removed", label: "Replaced", href: q("removed") }]} />
      <DataTable id="tubes" label="X-ray tubes" path="/assets/tubes" sp={sp} sort={sort} rows={rows} rowKey={(t) => t.id} columns={columns}
        empty={<EmptyState title={removed ? "No replaced tubes on record" : "No tubes on record"}>Open a CT or X-ray device from the register and record its tube, with the warranty and expected life, to forecast its replacement.</EmptyState>}
        footer={<ListPager paging={paging} path="/assets/tubes" sp={sp} what="tubes" />} />
      <Panel title="How the forecast works" className="mt-6">
        <p className="text-sm text-muted">Use is the latest counter reading less the counter when the tube was fitted. The rate of use comes from the readings, and gives the date the tube reaches its expected life (replacement) and its warranty use. The warranty ends on its months or its use, whichever comes first. Without an expected life the list sorts by the warranty end.</p>
      </Panel>
    </>
  );
}

const COLUMNS: Column<TubeListRow>[] = [
  { key: "scanner", label: "Scanner", sort: true, cell: (t) => <><Link href={`/assets/${t.assetId}#tubes`} className="font-mono text-sm font-semibold text-primary hover:underline">{t.tag}</Link><span className="block text-xs text-muted">{t.typeName} · {t.facilityName}</span></> },
  { key: "serial", label: "Tube serial", cell: (t) => <>{t.serialNumber}{(t.maker || t.model) && <span className="block text-xs text-muted">{[t.maker, t.model].filter(Boolean).join(" ")}</span>}</> },
  { key: "installed", label: "Fitted", sort: true, className: "whitespace-nowrap", cell: (t) => <>{formatDate(t.installedOn)}{t.removedOn && <span className="block text-xs text-muted">Removed {formatDate(t.removedOn)}</span>}</> },
  { key: "life", label: "Used of rated life", sort: true, cell: (t) => (
    <div className="min-w-36">
      <span className="text-sm">{formatNumber(t.forecast.used)}{t.expectedLife ? ` of ${formatNumber(t.expectedLife)}` : ""} {unitOf(t)}</span>
      {t.forecast.lifeUsed != null && <Meter pct={t.forecast.lifeUsed * 100} tone={t.forecast.lifeUsed >= 1 ? "danger" : t.forecast.lifeUsed >= 0.8 ? "warn" : "primary"} label={`${formatNumber(t.forecast.lifeUsed * 100)} % of expected life used`} />}
      {t.forecast.lastReading ? <span className="block text-xs text-muted">Read {formatDate(t.forecast.lastReading.readOn)}</span> : <span className="block text-xs text-muted">No readings</span>}
    </div>
  ) },
  { key: "replace", label: "Forecast replacement", sort: true, className: "whitespace-nowrap", cell: (t) => <>{t.forecast.replaceBy ? formatDate(t.forecast.replaceBy) : <span className="text-muted">—</span>} <Badge tone={TUBE_STATE_TONE[t.forecast.state]}>{TUBE_STATE_LABELS[t.forecast.state]}</Badge></> },
  { key: "warranty", label: "Warranty", sort: true, className: "whitespace-nowrap", cell: (t) => (
    t.forecast.warrantyEnd ? <>{t.forecast.outOfWarranty ? "Ended " : "Ends "}{formatDate(t.forecast.warrantyEnd)}<span className="block text-xs text-muted">{t.forecast.warrantyBy === "counter" ? "By use" : "By months"}</span></> : <span className="text-muted">None recorded</span>
  ) },
  { key: "cost", label: "Cost", sort: true, align: "right", optional: true, cell: (t) => (t.cost == null ? <span className="text-muted">—</span> : formatMoney(t.cost, t.currency ?? "EGP")) },
];
