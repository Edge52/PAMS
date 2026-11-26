import { AnalyticsFilters } from "@/components/analytics/filters";
import { buttonClass, Panel, Table, Td, Th, THead } from "@/components/ui";
import { filterQuery, parseFilters } from "@/lib/analytics/core";
import { BI_VIEWS } from "@/lib/analytics/bi-views";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { seesPrices } from "@/lib/auth/prices";
import { requirePermission } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics: export" };

/** Download the figures as Excel, or connect a BI tool to the read-only views (wave 40). */
export default async function ExportAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("reports.view");
  const f = parseFilters(await searchParams, todayISO());
  await analyticsScope(me, f); // checks access to a chosen hospital
  const prices = seesPrices(me.role);
  return (
    <>
      <AnalyticsFilters filters={f} />
      <Panel title="Download as Excel">
        <p className="mb-3 text-sm text-muted">
          One workbook for the filters above: {prices ? "budget lines and forecasts, " : ""}imaging scanners and the weekday × month table, the replacement wave
          {prices ? " and the devices due with their estimates" : ""}, and the hospital comparison. {prices ? "" : "Money is left out because your role does not see prices."}
        </p>
        <a href={`/analytics/export/xlsx?${filterQuery(f)}`} className={buttonClass("primary")} download>Download Excel file</a>
      </Panel>
      <div className="mt-5" />
      <Panel title="Power BI and other BI tools">
        <p className="mb-3 text-sm text-muted">
          The database has read-only views for BI tools. An administrator creates a read-only database account (<code>pams_bi</code>) that can only read these views;
          the steps and the Power BI connection are in the deploy guide (docs/deploy.md, &quot;Read-only access for BI tools&quot;).
          Anyone with that account sees prices and every hospital: give it only to people who may see both.
        </p>
        <Table>
          <THead><tr><Th>View</Th><Th>What it holds</Th></tr></THead>
          <tbody>{BI_VIEWS.map((v) => <tr key={v.name} className="border-b border-line last:border-0"><Td className="font-mono">{v.name}</Td><Td>{v.about}</Td></tr>)}</tbody>
        </Table>
      </Panel>
    </>
  );
}
