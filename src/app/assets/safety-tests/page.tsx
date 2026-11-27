import Link from "next/link";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, safetyTests } from "@/db/schema";
import { Badge, EmptyState, PageHeader, Panel, Stat, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { testDueState } from "@/lib/assets/safety-tests";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { sortRows } from "@/lib/list";
import { pageRows } from "@/lib/paging";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Safety tests" };

const TABS = ["due", "failed", "recent", "equipment"] as const;
const DUE_TONE = { overdue: "danger", soon: "warn", ok: "ok", never: "neutral" } as const;
const DUE_LABEL = { overdue: "Overdue", soon: "Due within 30 days", ok: "In date", never: "Never tested" } as const;

/** Electrical safety tests (wave 23): which devices are due, which failed, the latest tests and the test equipment. */
export default async function SafetyTestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "due";
  const today = todayISO();
  const inScope = scopeWhere(assets.facilityId, scope);

  // The latest test of each device.
  const latest = await db.selectDistinctOn([safetyTests.assetId], { t: safetyTests, tag: assets.assetTag, typeName: deviceTypes.name })
    .from(safetyTests).innerJoin(assets, eq(assets.id, safetyTests.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(inScope, ne(assets.status, "DISPOSED"))).orderBy(safetyTests.assetId, desc(safetyTests.testedOn), desc(safetyTests.id));
  const equipment = await db.select({ id: assets.id, tag: assets.assetTag, manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber, due: assets.calibrationDue, cert: assets.calibrationCertRef })
    .from(assets).where(and(inScope, eq(assets.isTestEquipment, true))).orderBy(asc(assets.calibrationDue));
  const [{ n: tested12 }] = await db.select({ n: sql<number>`count(*)::int` }).from(safetyTests).innerJoin(assets, eq(assets.id, safetyTests.assetId))
    .where(and(inScope, sql`${safetyTests.testedOn} >= current_date - 365`));
  const due = latest.filter((r) => r.t.result === "PASS" && testDueState(r.t.nextDue, today) !== "ok");
  const failed = latest.filter((r) => r.t.result === "FAIL");
  const calOut = equipment.filter((e) => !e.due || e.due < today);
  const sort = tableSort(sp, ["device", "tested", "next", "result"] as const);
  // Wave 41: every latest test is pageable (the "Latest tests" tab used to stop at 100), 50 a page.
  const { rows: shown, paging } = pageRows(sortRows(tab === "due" ? due : tab === "failed" ? failed : latest.toSorted((a, b) => b.t.testedOn.localeCompare(a.t.testedOn)), sort,
    { device: (r) => r.tag, tested: (r) => r.t.testedOn, next: (r) => r.t.nextDue, result: (r) => r.t.result }), sp);
  const href = (t: string) => `/assets/safety-tests?tab=${t}`;

  return (
    <>
      <PageHeader title="Safety tests" description="Electrical safety tests after IEC 62353: after every repair and at intervals in service. Record a test from the device's own page." />
      <Notice sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tests in 12 months" value={tested12} />
        <Stat label="Due or overdue" value={due.length} href={href("due")} />
        <Stat label="Failed, not retested" value={failed.length} href={href("failed")} />
        <Stat label="Analysers out of calibration" value={calOut.length} hint={`${equipment.length} test device${equipment.length === 1 ? "" : "s"} on record`} href={href("equipment")} />
      </div>
      <TabLinks active={tab} tabs={[{ key: "due", label: `Due (${due.length})`, href: href("due") }, { key: "failed", label: `Failed (${failed.length})`, href: href("failed") }, { key: "recent", label: "Latest tests", href: href("recent") }, { key: "equipment", label: `Test equipment (${equipment.length})`, href: href("equipment") }]} />
      {tab === "equipment" ? (
        equipment.length === 0 ? (
          <EmptyState title="No test equipment on record">Open the safety analyser&apos;s page in the asset register, tick Test equipment and enter when its calibration runs out. Tests can then be recorded with it.</EmptyState>
        ) : (
          <Table>
            <THead><tr><Th>Test device</Th><Th>Serial</Th><Th>Calibration runs out</Th><Th>Certificate</Th></tr></THead>
            <tbody>{equipment.map((e) => (
              <tr key={e.id}>
                <Td><Link href={`/assets/${e.id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{e.tag}</Link><span className="block text-sm">{[e.manufacturer, e.model].filter(Boolean).join(" ") || "—"}</span></Td>
                <Td>{e.serial ?? "—"}</Td>
                <Td>{e.due ? <>{formatDate(e.due)} <Badge tone={e.due < today ? "danger" : testDueState(e.due, today) === "soon" ? "warn" : "ok"}>{e.due < today ? "Run out: can't be used" : testDueState(e.due, today) === "soon" ? "Within 30 days" : "In date"}</Badge></> : <Badge tone="danger">Not recorded</Badge>}</Td>
                <Td>{e.cert ?? "—"}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )
      ) : shown.length === 0 ? (
        <EmptyState title={tab === "due" ? "Nothing due" : tab === "failed" ? "No failed tests waiting" : "No tests recorded yet"}>
          {latest.length === 0 ? "Open a device in the asset register and press Record a safety test." : "Every tested device is in date."}
        </EmptyState>
      ) : (
        <DataTable id="safety-tests" label="Safety tests" path="/assets/safety-tests" sp={sp} sort={sort} rows={shown} rowKey={(r) => r.t.id} columns={testColumns(today)}
          footer={<ListPager paging={paging} path="/assets/safety-tests" sp={sp} what="devices" />} />
      )}
      <Panel title="How the result is decided" className="mt-6">
        <p className="text-sm text-muted">A test passes when the visual and functional checks pass and every required reading is within its limit: protective earth 0.3 Ω (class I), equipment leakage 500 µA for class I and 100 µA for class II (1000 and 500 by the alternative method), applied part leakage 5000 µA for type BF and 50 µA for type CF. A required reading left empty fails the test. These are the usual IEC 62353 figures; check them against your copy of the standard and the maker&apos;s manual.</p>
      </Panel>
    </>
  );
}

type TestRow = { t: typeof safetyTests.$inferSelect; tag: string; typeName: string };

function testColumns(today: string): Column<TestRow>[] {
  return [
    { key: "device", label: "Device", sort: true, cell: ({ t, tag, typeName }) => <><Link href={`/assets/${t.assetId}#safety-tests`} className="font-mono text-sm font-semibold text-primary hover:underline">{tag}</Link><span className="block text-xs text-muted">{typeName}</span></> },
    { key: "tested", label: "Last test", sort: true, className: "whitespace-nowrap", cell: ({ t }) => <>{formatDate(t.testedOn)}<span className="block text-xs text-muted">{t.testedByName}</span></> },
    { key: "result", label: "Result", sort: true, cell: ({ t }) => <><Badge tone={t.result === "PASS" ? "ok" : "danger"}>{t.result === "PASS" ? "Passed" : "Failed"}</Badge>{t.failures[0] && <span className="mt-1 block max-w-xs text-xs text-muted">{t.failures[0]}</span>}</> },
    { key: "next", label: "Next due", sort: true, className: "whitespace-nowrap", cell: ({ t }) => { const state = testDueState(t.nextDue, today);
      return t.nextDue ? <>{formatDate(t.nextDue)} <Badge tone={DUE_TONE[state]}>{DUE_LABEL[state]}</Badge></> : <span className="text-sm text-muted">Retest after repair</span>; } },
    { key: "analyser", label: "Analyser", optional: true, cell: ({ t }) => <span className="text-sm">{t.analyserLabel ?? "—"}</span> },
  ];
}
