import Link from "next/link";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { assets, assetSecurity, deviceTypes, facilities } from "@/db/schema";
import { Badge, EmptyState, PageHeader, Stat, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { SortTh } from "@/components/ui/sort-th";
import { scopeWhere } from "@/lib/assets/access";
import { concerns, CONNECTION_LABELS, worst } from "@/lib/assets/device-security";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { parseSort, sortRows } from "@/lib/list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Device security" };

const TABS = ["attention", "network", "patient", "all"] as const;

/** Device security (wave 25): the devices on the network or holding patient data, and what needs attention on each. */
export default async function DeviceSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "attention";
  const today = todayISO();
  const rows = (await db.select({ s: assetSecurity, id: assets.id, tag: assets.assetTag, typeName: deviceTypes.name, facility: facilities.name })
    .from(assetSecurity).innerJoin(assets, eq(assets.id, assetSecurity.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .where(and(scopeWhere(assets.facilityId, scope), ne(assets.status, "DISPOSED"))).orderBy(asc(assets.assetTag)))
    .map((r) => { const list = concerns(r.s, today); return { ...r, list, level: worst(list) }; });
  const online = rows.filter((r) => r.s.connection !== "NONE");
  const patient = rows.filter((r) => r.s.storesPatientData === "YES" || r.s.sendsPatientData === "YES");
  const attention = rows.filter((r) => r.level !== "none");
  const high = rows.filter((r) => r.level === "high");
  const oldOs = online.filter((r) => r.s.osSupportEnds && r.s.osSupportEnds < today);
  const sort = parseSort(sp, ["device", "level", "os", "patched", "reviewed"] as const);
  const rank = { high: 0, medium: 1, none: 2 } as const;
  const base = tab === "attention" ? attention.toSorted((a, b) => rank[a.level] - rank[b.level]) : tab === "network" ? online : tab === "patient" ? patient : rows;
  const shown = sortRows(base, sort, { device: (r) => r.tag, level: (r) => rank[r.level], os: (r) => r.s.osSupportEnds, patched: (r) => r.s.lastPatchedOn, reviewed: (r) => r.s.reviewedOn });
  const href = (t: string) => `/assets/security?tab=${t}`;

  return (
    <>
      <PageHeader title="Device security" description="Devices on the network or holding patient data, from the details recorded on each device's page (Network and security)." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Devices recorded" value={rows.length} hint={`${online.length} on the network`} href={href("all")} />
        <Stat label="Need attention now" value={high.length} hint={`${attention.length} with something to check`} href={href("attention")} />
        <Stat label="System out of support" value={oldOs.length} hint="No more security fixes" href={href("network")} />
        <Stat label="Hold or send patient data" value={patient.length} href={href("patient")} />
      </div>
      <TabLinks active={tab} tabs={[
        { key: "attention", label: `To check (${attention.length})`, href: href("attention") }, { key: "network", label: `On the network (${online.length})`, href: href("network") },
        { key: "patient", label: `Patient data (${patient.length})`, href: href("patient") }, { key: "all", label: `All recorded (${rows.length})`, href: href("all") },
      ]} />
      {rows.length === 0 ? (
        <EmptyState title="No device has network and security details yet">Open a device in the asset register and fill in Network and security. Start with imaging systems, monitors, analysers and anything else with a network cable.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title={tab === "attention" ? "Nothing to check" : "No devices here"}>{tab === "attention" ? "Every recorded device is up to date." : "No recorded device matches."}</EmptyState>
      ) : (
        <Table>
          <THead><tr><SortTh k="device">Device</SortTh><Th>Connection</Th><SortTh k="os">Operating system</SortTh><SortTh k="patched">Last update</SortTh><SortTh k="level">To check</SortTh><SortTh k="reviewed">Reviewed</SortTh></tr></THead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <Td><Link href={`/assets/${r.id}#device-security`} className="font-semibold text-primary hover:underline">{r.tag}</Link><span className="block text-xs text-muted">{r.typeName} · {r.facility}</span></Td>
                <Td>{CONNECTION_LABELS[r.s.connection]}{r.s.ipAddress && <span className="block font-mono text-xs text-muted">{r.s.ipAddress}</span>}</Td>
                <Td>{r.s.operatingSystem ?? "—"}{r.s.osSupportEnds && <span className={`block text-xs ${r.s.osSupportEnds < today ? "font-semibold text-danger" : "text-muted"}`}>fixes until {formatDate(r.s.osSupportEnds)}</span>}</Td>
                <Td>{r.s.lastPatchedOn ? formatDate(r.s.lastPatchedOn) : "—"}</Td>
                <Td>
                  {r.level === "none" ? <Badge tone="ok">Nothing</Badge> : (
                    <ul className="space-y-0.5 text-[13px]">{r.list.map((c) => <li key={c.text} className={c.level === "high" ? "font-semibold text-danger" : ""}>{c.text}</li>)}</ul>
                  )}
                </Td>
                <Td>{r.s.reviewedOn ? formatDate(r.s.reviewedOn) : "Never"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
