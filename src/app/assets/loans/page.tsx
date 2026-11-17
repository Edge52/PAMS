import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Stat, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { SortTh } from "@/components/ui/sort-th";
import { Notice } from "@/components/assets/bits";
import { listLoans } from "@/lib/assets/loans-server";
import { CHECK_LABELS, checkState, DIRECTION_LABELS, LOAN_STATE_LABELS, LOAN_STATE_TONE, loanState } from "@/lib/assets/loans";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { parseSort, sortRows } from "@/lib/list";

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
  const all = (await listLoans(scope)).map((r) => ({ ...r, state: loanState(r.l, today), check: checkState(r.l) }));
  const counts = { open: all.filter((r) => r.state !== "RETURNED").length, overdue: all.filter((r) => r.state === "OVERDUE").length, returned: all.filter((r) => r.state === "RETURNED").length };
  const unchecked = all.filter((r) => r.state !== "RETURNED" && (r.check === "NOT_CHECKED" || r.check === "NOT_FIT")).length;
  const shown = all.filter((r) => tab === "all" || (tab === "open" ? r.state !== "RETURNED" : tab === "overdue" ? r.state === "OVERDUE" : r.state === "RETURNED"));
  const sort = parseSort(sp, ["number", "device", "party", "out", "due"] as const);
  const rows = sortRows(shown, sort, { number: (r) => r.l.number, device: (r) => r.device, party: (r) => r.l.otherParty, out: (r) => r.l.outOn, due: (r) => r.l.dueBackOn ?? "9999" });
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
        <Table>
          <THead><tr><SortTh k="number">Loan</SortTh><SortTh k="device">Device</SortTh><SortTh k="party">With</SortTh><SortTh k="out">Out</SortTh><SortTh k="due">Due back</SortTh><Th>State</Th><Th className="hidden md:table-cell">Check before use</Th></tr></THead>
          <tbody>
            {rows.map(({ l, device, facility, state, check, department }) => (
              <tr key={l.id}>
                <Td><Link href={`/assets/loans/${l.id}`} className="font-semibold text-primary hover:underline">{l.number}</Link>{l.isRental && <span className="block text-xs text-muted">Rental</span>}</Td>
                <Td>{l.assetId ? <Link href={`/assets/${l.assetId}`} className="text-primary hover:underline">{device}</Link> : device}<span className="block text-xs text-muted">{[facility, department].filter(Boolean).join(" · ")}</span></Td>
                <Td>{DIRECTION_LABELS[l.direction]} <b>{l.otherParty}</b></Td>
                <Td className="whitespace-nowrap">{formatDate(l.outOn)}</Td>
                <Td className="whitespace-nowrap">{l.returnedOn ? <span className="text-muted">back {formatDate(l.returnedOn)}</span> : formatDate(l.dueBackOn)}</Td>
                <Td><Badge tone={LOAN_STATE_TONE[state]}>{LOAN_STATE_LABELS[state]}</Badge></Td>
                <Td className="hidden md:table-cell">{check === "NOT_NEEDED" ? <span className="text-sm text-muted">—</span> : <Badge tone={check === "FIT" ? "ok" : check === "NOT_FIT" ? "danger" : "warn"}>{CHECK_LABELS[check]}</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
