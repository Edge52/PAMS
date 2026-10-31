import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, recalls } from "@/db/schema";
import { Badge, EmptyState, LinkButton, PageHeader, StatusBadge, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { Meter, Notice } from "@/components/assets/bits";
import { RECALL_ACTION_LABELS, type RecallAction } from "@/lib/assets/recalls";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recalls" };

export default async function RecallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = sp.tab === "closed" ? "closed" : sp.tab === "all" ? "all" : "open";
  // Device counts only for the user's hospitals.
  const inScope = scope === null ? sql`true` : scope.length ? sql`a.facility_id in (${sql.join(scope.map((s) => sql`${s}`), sql`, `)})` : sql`false`;
  const count = (status?: string) => sql<number>`(select count(*) from recall_assets x join assets a on a.id = x.asset_id
    where x.recall_id = ${recalls.id} and ${inScope}${status ? sql` and x.status = ${status}` : sql``})::int`;
  const rows = await db.select({ r: recalls, typeName: deviceTypes.name, total: count(), pending: count("PENDING") })
    .from(recalls).leftJoin(deviceTypes, eq(deviceTypes.id, recalls.deviceTypeId))
    .where(tab === "all" ? undefined : eq(recalls.status, tab === "open" ? "OPEN" : "CLOSED"))
    .orderBy(desc(recalls.urgent), desc(recalls.createdAt)).limit(300);
  const canEdit = can(me.role, "recalls.edit");
  return (
    <>
      <PageHeader title="Recalls and safety notices" description="Field safety notices from manufacturers and regulators, matched to the devices in your register, with each device tracked until it is dealt with."
        actions={canEdit && <LinkButton href="/assets/recalls/new" variant="primary">Record a notice</LinkButton>} />
      <Notice sp={sp} />
      <TabLinks active={tab} tabs={[{ key: "open", label: "Open", href: "/assets/recalls" }, { key: "closed", label: "Closed", href: "/assets/recalls?tab=closed" }, { key: "all", label: "All", href: "/assets/recalls?tab=all" }]} />
      {rows.length === 0 ? (
        <EmptyState title={tab === "open" ? "No open recalls" : "No recalls here"} action={canEdit ? <LinkButton href="/assets/recalls/new" variant="primary">Record a notice</LinkButton> : undefined}>
          When a manufacturer or the regulator issues a field safety notice, record it here. The system finds the affected devices.
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Notice</Th><Th>Devices</Th><Th>Required action</Th><Th>Due</Th><Th>Progress</Th><Th>Status</Th></tr></THead>
          <tbody>{rows.map(({ r, typeName, total, pending }) => {
            const pct = total ? Math.round(((total - pending) / total) * 100) : 100;
            return (
              <tr key={r.id}>
                <Td><Link href={`/assets/recalls/${r.id}`} className="font-semibold text-primary hover:underline">{r.number}</Link> {r.urgent && <Badge tone="danger">Urgent</Badge>}
                  <div className="max-w-72 text-[13px]">{r.title}</div><div className="text-xs text-muted">{[r.source, r.reference].filter(Boolean).join(" · ")}</div></Td>
                <Td>{[r.manufacturer, r.modelPattern].filter(Boolean).join(" ") || typeName || "—"}<div className="text-xs text-muted">{typeName && (r.manufacturer || r.modelPattern) ? typeName : ""}</div></Td>
                <Td className="text-[13px]">{RECALL_ACTION_LABELS[r.action as RecallAction]}</Td>
                <Td className="whitespace-nowrap">{formatDate(r.dueDate)}</Td>
                <Td className="min-w-36"><Meter pct={pct} tone={pending ? "warn" : "ok"} label="Devices dealt with" />
                  <div className="mt-1 text-xs text-muted">{formatNumber(total - pending)} of {formatNumber(total)} done</div></Td>
                <Td><StatusBadge value={r.status} /></Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
    </>
  );
}
