import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, LinkButton, PageHeader, Panel } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { listFacilities } from "@/lib/assets/queries";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { seesPrices } from "@/lib/auth/prices";
import { ENTITY_LABEL, evaluate, findRule, recordHref, type Hit } from "@/lib/data-quality";
import { loadDqData } from "@/lib/data-quality-server";
import { formatNumber, todayISO } from "@/lib/format";
import { sortRows } from "@/lib/list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data quality" };

const SHOWN = 500;
const SORT = ["record", "hospital"] as const;

export default async function DataQualityRulePage({ params, searchParams }: {
  params: Promise<{ rule: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requirePermission("reports.view");
  const { rule: ruleId } = await params;
  const sp = await searchParams;
  const rule = findRule(ruleId);
  if (!rule) notFound();
  const prices = seesPrices(me.role);
  if (!prices && (rule.entity === "offer" || rule.entity === "po")) await requirePermission("prices.view");
  const scope = await facilityScope(me);
  const facs = await listFacilities(scope);
  const fac = facs.find((f) => f.id === Number(sp.facilityId)) ?? null;
  if (fac) await requireFacilityAccess(fac.id, me);
  const today = todayISO();
  const { data } = await loadDqData(fac?.id ?? null, scope, today, prices);
  const [res] = evaluate(data, today, (r) => r.id !== rule.id);
  const name = new Map(facs.map((f) => [f.id, f.name]));
  const sort = tableSort(sp, SORT);
  const hits = sortRows(res?.hits ?? [], sort, { record: (h) => h.label, hospital: (h) => (h.facilityId ? name.get(h.facilityId) : null) });
  const back = `/reports/data-quality${fac ? `?facilityId=${fac.id}` : ""}`;

  return (
    <>
      <PageHeader back={{ href: back, label: "Data quality" }} title={rule.title}
        description={<>{fac ? fac.name : "All hospitals you can see"} · <Badge tone={rule.severity === "high" ? "danger" : rule.severity === "medium" ? "warn" : "info"}>{rule.severity}</Badge> · {rule.fix}</>} />
      <Panel title={`${ENTITY_LABEL[rule.entity]} (${formatNumber(hits.length)})`} padded={false}>
        <DataTable<Hit> id="dq-rule" label={rule.title} path={`/reports/data-quality/${rule.id}`} sp={sp} sort={sort} rows={hits.slice(0, SHOWN)} rowKey={(h) => h.id}
          columns={[
            { key: "record", label: "Record", sort: true, cell: (h) => <Link href={recordHref(rule.entity, h.id)} className="font-mono font-semibold text-primary hover:underline">{h.label}</Link> },
            { key: "hospital", label: "Hospital", sort: true, cell: (h) => (h.facilityId ? name.get(h.facilityId) ?? "—" : "No hospital") },
            { key: "open", label: "Fix", head: <span className="sr-only">Fix</span>, align: "right", cell: (h) => <Link href={recordHref(rule.entity, h.id)} className="text-sm text-primary hover:underline">Open and fix</Link> },
          ]}
          empty={<EmptyState title="Nothing to fix" action={<LinkButton href={back}>Back to the rules</LinkButton>}>No record breaks this rule now.</EmptyState>} />
      </Panel>
      {hits.length > SHOWN && <p className="mt-3 text-xs text-muted">Showing the first {SHOWN} of {formatNumber(hits.length)}. Fix these, then come back for the rest.</p>}
    </>
  );
}
