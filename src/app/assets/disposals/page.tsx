import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, disposals } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader, StatusBadge, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { METHOD_LABELS, REASON_LABELS } from "@/lib/assets/disposal";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disposals" };

const OPEN = ["DRAFT", "PENDING_APPROVAL", "APPROVED"] as const;

export default async function DisposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = sp.tab === "done" ? "done" : sp.tab === "all" ? "all" : "open";
  const rows = await db.select({ d: disposals, tag: assets.assetTag, typeName: deviceTypes.name }).from(disposals)
    .innerJoin(assets, eq(assets.id, disposals.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(scopeWhere(disposals.facilityId, scope), tab === "open" ? inArray(disposals.status, [...OPEN]) : tab === "done" ? inArray(disposals.status, ["COMPLETED", "REJECTED", "CANCELLED"]) : undefined))
    .orderBy(desc(disposals.createdAt)).limit(500);
  return (
    <>
      <PageHeader title="Disposals" description="Requests to condemn devices, their approval, and how each device left the hospital."
        actions={can(me.role, "assets.dispose") && <LinkButton href="/assets/replacement">Replacement plan</LinkButton>} />
      <Notice sp={sp} />
      <TabLinks active={tab} tabs={[{ key: "open", label: "In progress", href: "/assets/disposals" }, { key: "done", label: "Finished", href: "/assets/disposals?tab=done" }, { key: "all", label: "All", href: "/assets/disposals?tab=all" }]} />
      {rows.length === 0 ? (
        <EmptyState title="No disposal requests here">To condemn a device, open it in the register and choose “Propose disposal”.</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Request</Th><Th>Device</Th><Th>Reason</Th><Th>Method</Th><Th>Requested</Th><Th>Status</Th></tr></THead>
          <tbody>{rows.map(({ d, tag, typeName }) => (
            <tr key={d.id}>
              <Td><Link href={`/assets/disposals/${d.id}`} className="font-semibold text-primary hover:underline">{d.number}</Link></Td>
              <Td><Link href={`/assets/${d.assetId}`} className="font-mono text-[13px] text-primary hover:underline">{tag}</Link><div className="text-xs text-muted">{typeName}</div></Td>
              <Td>{REASON_LABELS[d.reason]}</Td>
              <Td>{METHOD_LABELS[d.method]}{d.proceeds ? <div className="text-xs text-muted">{formatMoney(d.proceeds, d.currency ?? "EGP")}</div> : null}</Td>
              <Td className="whitespace-nowrap">{formatDateTime(d.createdAt)}<div className="text-xs text-muted">{d.requestedByName}</div></Td>
              <Td><StatusBadge value={d.status} />{d.disposedOn && <div className="text-xs text-muted">{formatDate(d.disposedOn)}</div>}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </>
  );
}
