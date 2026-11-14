import Link from "next/link";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, incidents } from "@/db/schema";
import { Badge, EmptyState, LinkButton, PageHeader, Stat, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { SortTh } from "@/components/ui/sort-th";
import { Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { HARM_LABELS, HARM_TONE, INCIDENT_STATUS_LABELS, incidentTodos, reportable } from "@/lib/assets/incidents";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { parseSort, sortRows } from "@/lib/list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incidents" };

const TABS = ["open", "closed", "all"] as const;
const HARM_RANK = { DEATH: 4, SERIOUS: 3, MINOR: 2, NEAR_MISS: 1, NONE: 0 } as const;

/** Device incidents (wave 23): what went wrong, who was told and what was done about it. */
export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "open";
  const today = todayISO();
  const found = await db.select({ i: incidents, tag: assets.assetTag, typeName: deviceTypes.name, facility: facilities.code }).from(incidents)
    .innerJoin(assets, eq(assets.id, incidents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, incidents.facilityId))
    .where(and(scopeWhere(incidents.facilityId, scope), tab === "open" ? ne(incidents.status, "CLOSED") : tab === "closed" ? eq(incidents.status, "CLOSED") : undefined))
    .orderBy(desc(incidents.occurredAt)).limit(500);
  const [k] = await db.select({
    open: sql<number>`count(*) filter (where ${incidents.status} <> 'CLOSED')::int`,
    serious: sql<number>`count(*) filter (where ${incidents.status} <> 'CLOSED' and ${incidents.harm} in ('SERIOUS','DEATH'))::int`,
    untold: sql<number>`count(*) filter (where ${incidents.status} <> 'CLOSED' and ${incidents.harm} in ('SERIOUS','DEATH') and ${incidents.edaNotifiedOn} is null)::int`,
    year: sql<number>`count(*) filter (where ${incidents.occurredAt} >= now() - interval '365 days')::int`,
  }).from(incidents).where(scopeWhere(incidents.facilityId, scope));
  const sort = parseSort(sp, ["number", "device", "happened", "harm", "status"] as const);
  const rows = sortRows(found, sort, { number: (r) => r.i.number, device: (r) => r.tag, happened: (r) => r.i.occurredAt.getTime(), harm: (r) => HARM_RANK[r.i.harm], status: (r) => r.i.status });
  const href = (t: string) => `/assets/incidents?tab=${t}`;

  return (
    <>
      <PageHeader title="Incidents" description="Something went wrong with a device, or nearly did. Record it here, keep the device as found, and note who was told. Serious harm is reported to the manufacturer and the Egyptian Drug Authority."
        actions={can(me.role, "workorders.report") ? <LinkButton href="/assets/incidents/new" variant="primary">Report an incident</LinkButton> : undefined} />
      <Notice sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open incidents" value={k.open} />
        <Stat label="Serious, still open" value={k.serious} />
        <Stat label="EDA not told yet" value={k.untold} hint={k.untold ? "Serious incidents with no report date" : "None waiting"} />
        <Stat label="Last 12 months" value={k.year} />
      </div>
      <TabLinks active={tab} tabs={[{ key: "open", label: "Open", href: href("open") }, { key: "closed", label: "Closed", href: href("closed") }, { key: "all", label: "All", href: href("all") }]} />
      {rows.length === 0 ? (
        <EmptyState title={tab === "open" ? "No open incidents" : "No incidents here"} action={can(me.role, "workorders.report") ? <LinkButton href="/assets/incidents/new">Report an incident</LinkButton> : undefined}>
          When a device harms someone, nearly does, or behaves dangerously, report it from here or from the device&apos;s page.
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><SortTh k="number">Incident</SortTh><SortTh k="device">Device</SortTh><SortTh k="happened">Happened</SortTh><SortTh k="harm">Harm</SortTh><SortTh k="status">Status</SortTh><Th>Still to do</Th></tr></THead>
          <tbody>
            {rows.map(({ i, tag, typeName, facility }) => {
              const todo = incidentTodos(i, today);
              return (
                <tr key={i.id}>
                  <Td><Link href={`/assets/incidents/${i.id}`} className="font-semibold text-primary hover:underline">{i.number}</Link><span className="block text-sm">{i.title}</span></Td>
                  <Td><Link href={`/assets/${i.assetId}`} className="font-mono text-sm text-primary hover:underline">{tag}</Link><span className="block text-xs text-muted">{typeName} · {facility}</span></Td>
                  <Td className="whitespace-nowrap">{formatDate(i.occurredAt)}</Td>
                  <Td><Badge tone={HARM_TONE[i.harm]}>{HARM_LABELS[i.harm].split(":")[0]}</Badge>{reportable(i.harm) && <span className="mt-1 block text-xs text-muted">Reportable</span>}</Td>
                  <Td><Badge tone={i.status === "CLOSED" ? "ok" : i.status === "OPEN" ? "warn" : "info"}>{INCIDENT_STATUS_LABELS[i.status]}</Badge></Td>
                  <Td>{todo.length === 0 ? <span className="text-sm text-muted">Nothing</span> : <span className={`text-sm ${todo[0].level === "danger" ? "font-semibold text-danger" : ""}`}>{todo[0].text}{todo.length > 1 && <span className="text-muted"> +{todo.length - 1} more</span>}</span>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
