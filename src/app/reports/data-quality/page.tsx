import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { NativeSelect } from "@/components/assets/bits";
import { listFacilities } from "@/lib/assets/queries";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { seesPrices } from "@/lib/auth/prices";
import { ENTITY_LABEL, evaluate, hospitalScores, sortResults, type RuleResult, type Severity } from "@/lib/data-quality";
import { loadDqData } from "@/lib/data-quality-server";
import { formatNumber, todayISO } from "@/lib/format";
import { sortRows } from "@/lib/list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data quality" };

const SORT = ["rule", "severity", "count"] as const;
const SEV_TONE: Record<Severity, "danger" | "warn" | "info"> = { high: "danger", medium: "warn", low: "info" };
const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export default async function DataQualityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("reports.view");
  const sp = await searchParams;
  const scope = await facilityScope(me);
  const facs = await listFacilities(scope);
  if (!facs.length) return <><PageHeader title="Data quality" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const wanted = Number(sp.facilityId);
  const fac = facs.find((f) => f.id === wanted) ?? null;
  if (fac) await requireFacilityAccess(fac.id, me);
  const today = todayISO();
  const prices = seesPrices(me.role);
  const { data, cut } = await loadDqData(fac?.id ?? null, scope, today, prices);
  const results = sortResults(evaluate(data, today, (r) => !prices && (r.entity === "offer" || r.entity === "po")));
  const scores = hospitalScores(data.assets, today);
  const name = new Map(facs.map((f) => [f.id, f.name]));
  const sort = tableSort(sp, SORT);
  const rows = sortRows(results, sort, { rule: (r) => r.rule.title, severity: (r) => SEV_RANK[r.rule.severity], count: (r) => r.hits.length });
  const failing = results.filter((r) => r.hits.length).length;
  const q = fac ? `?facilityId=${fac.id}` : "";

  return (
    <>
      <PageHeader back={{ href: "/reports", label: "Reports" }} title="Data quality"
        description="Gaps and mistakes in the records, worked out now. Open a rule to see the records and fix them." />
      <form action="/reports/data-quality" className="mb-4 flex flex-wrap items-end gap-2">
        <NativeSelect name="facilityId" aria-label="Hospital" placeholder="All hospitals you can see" options={facs.map((f) => ({ value: f.id, label: f.name }))} value={fac?.id ?? ""} />
        <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Show</button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {scores.map((s) => (
          <Stat key={s.facilityId} label={name.get(s.facilityId) ?? `Hospital ${s.facilityId}`} value={s.pct == null ? "—" : `${formatNumber(s.pct, 1)} %`}
            hint={`${formatNumber(s.clean)} of ${formatNumber(s.devices)} devices pass every device rule`} />
        ))}
        <Stat label="Rules with problems" value={`${failing} of ${results.length}`} />
      </div>

      <Panel title="Rules" padded={false}>
        <DataTable<RuleResult> id="data-quality" label="Data quality rules" path="/reports/data-quality" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.rule.id}
          columns={[
            { key: "rule", label: "Rule", sort: true, cell: (r) => (
              <span><Link href={`/reports/data-quality/${r.rule.id}${q}`} className="font-semibold text-primary hover:underline">{r.rule.title}</Link>
                <span className="block text-xs text-muted">{r.rule.fix}</span></span>) },
            { key: "what", label: "Records", cell: (r) => ENTITY_LABEL[r.rule.entity], className: "hidden md:table-cell" },
            { key: "severity", label: "Severity", sort: true, cell: (r) => <Badge tone={SEV_TONE[r.rule.severity]}>{r.rule.severity}</Badge> },
            { key: "count", label: "Count", sort: true, align: "right", cell: (r) => r.hits.length
              ? <Link href={`/reports/data-quality/${r.rule.id}${q}`} className="font-semibold text-primary hover:underline">{formatNumber(r.hits.length)}</Link>
              : <Badge tone="ok">None</Badge> },
          ]} />
      </Panel>
      <ul className="mt-3 space-y-1 text-xs text-muted">
        <li>Score = devices (not disposed) that pass every device rule, as a share of all devices.</li>
        <li>Work orders: open jobs and jobs finished in the last 12 months. Offers and contracts: the last two years.</li>
        {!prices && <li>Rules on offers and invoices are shown only to people who may see prices.</li>}
        {cut.length > 0 && <li className="text-warn">Only the first 20,000 {cut.join(", ")} were checked.</li>}
      </ul>
    </>
  );
}
