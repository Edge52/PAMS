import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Stat, TabLinks } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";
import { Notice } from "@/components/assets/bits";
import { LOAN_SORT_KEYS, loanCounts, loanPage } from "@/lib/assets/loans-server";
import { CHECK_LABELS, checkState, DIRECTION_LABELS, LOAN_STATE_LABELS, LOAN_STATE_TONE, loanState } from "@/lib/assets/loans";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { PAGE_SIZE, pageFor } from "@/lib/paging";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loans and rentals" };

const TABS = ["open", "overdue", "returned", "all"] as const;

/** Loan and rental equipment (wave 27): devices borrowed from or lent to a supplier or another hospital. */
export default async function LoansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "open";
  const today = todayISO();
  // Wave 41: figures, tab, sort and page in the database (it used to read up to 1,000 loans and filter them here).
  const sort = tableSort(sp, LOAN_SORT_KEYS);
  const counts = await loanCounts(scope, today);
  const n = tab === "all" ? counts.open + counts.returned : counts[tab];
  const paging = pageFor(sp, n, PAGE_SIZE);
  const found = await loanPage(scope, tab, today, sort, paging.size, paging.offset);
  const rows = found.rows.map((r) => ({ ...r, state: loanState(r.l, today), check: checkState(r.l) }));
  const unchecked = counts.unchecked;
  const canEdit = can(me.role, "assets.edit");
  const href = (t: string) => `/assets/loans?tab=${t}`;
  return (
    <>
      <PageHeader title="Loans and rentals" description="Devices borrowed from a supplier or another hospital, rented, or lent out. Check a borrowed device before it is used, and get it back on time."
        actions={canEdit ? <LinkButton href="/assets/loans/new" variant="primary">Record a loan</LinkButton> : undefined} />
      <Notice sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Out now" value={formatNumber(counts.open)} href={href("open")} />
        <Stat label="Overdue" value={formatNumber(counts.overdue)} href={href("overdue")} hint={counts.overdue ? "Past the due-back date" : "None"} />
        <Stat label="Borrowed, not cleared for use" value={formatNumber(unchecked)} hint="Not checked yet, or not fit" />
        <Stat label="Returned" value={formatNumber(counts.returned)} href={href("returned")} />
      </div>
      <TabLinks active={tab} tabs={[
        { key: "open", label: `Open (${counts.open})`, href: href("open") }, { key: "overdue", label: `Overdue (${counts.overdue})`, href: href("overdue") },
        { key: "returned", label: `Returned (${counts.returned})`, href: href("returned") }, { key: "all", label: "All", href: href("all") },
      ]} />
      {rows.length === 0 ? (
        <EmptyState title={tab === "overdue" ? "Nothing overdue" : "No loans here"} action={canEdit ? <LinkButton href="/assets/loans/new">Record a loan</LinkButton> : undefined}>
          When a supplier lends a device during a repair, a device is rented, or another hospital borrows one of ours, record it here.
        </EmptyState>
      ) : (
        <DataTable id="loans" label="Loans and rentals" path="/assets/loans" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.l.id} columns={COLUMNS}
          footer={<ListPager paging={paging} path="/assets/loans" sp={sp} what="loans" />} />
      )}
    </>
  );
}

type Row = Awaited<ReturnType<typeof loanPage>>["rows"][number] & { state: ReturnType<typeof loanState>; check: ReturnType<typeof checkState> };

const COLUMNS: Column<Row>[] = [
  { key: "number", label: "Loan", sort: true, cell: ({ l }) => <><Link href={`/assets/loans/${l.id}`} className="font-semibold text-primary hover:underline">{l.number}</Link>{l.isRental && <span className="block text-xs text-muted">Rental</span>}</> },
  { key: "device", label: "Device", sort: true, cell: ({ l, device, facility, department }) => <>{l.assetId ? <Link href={`/assets/${l.assetId}`} className="text-primary hover:underline">{device}</Link> : device}<span className="block text-xs text-muted">{[facility, department].filter(Boolean).join(" · ")}</span></> },
  { key: "party", label: "With", sort: true, cell: ({ l }) => <>{DIRECTION_LABELS[l.direction]} <b>{l.otherParty}</b></> },
  { key: "out", label: "Out", sort: true, className: "whitespace-nowrap", cell: ({ l }) => formatDate(l.outOn) },
  { key: "due", label: "Due back", sort: true, className: "whitespace-nowrap", cell: ({ l }) => (l.returnedOn ? <span className="text-muted">back {formatDate(l.returnedOn)}</span> : formatDate(l.dueBackOn)) },
  { key: "state", label: "State", cell: ({ state }) => <Badge tone={LOAN_STATE_TONE[state]}>{LOAN_STATE_LABELS[state]}</Badge> },
  { key: "check", label: "Check before use", optional: true, className: "hidden md:table-cell", cell: ({ check }) => (check === "NOT_NEEDED" ? <span className="text-sm text-muted">—</span> : <Badge tone={check === "FIT" ? "ok" : check === "NOT_FIT" ? "danger" : "warn"}>{CHECK_LABELS[check]}</Badge>) },
];
