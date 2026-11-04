import Link from "next/link";
import { Button, Field, Input, PageHeader, Panel } from "@/components/ui";
import { NativeSelect } from "@/components/assets/bits";
import { requirePermission } from "@/lib/auth/session";
import { auditCount, auditFilter, auditRows, auditTypes, recordHref } from "@/lib/audit";
import { formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };
const PAGE = 100;

/** Audit log viewer (wave 12): who did what to which record, and when. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("users.manage");
  const sp = await searchParams;
  const f = auditFilter(sp);
  const page = Math.max(0, Number(sp.page) || 0);
  const [rows, total, types] = await Promise.all([auditRows(f, PAGE, page * PAGE), auditCount(f), auditTypes()]);
  const qs = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return `?${u.toString()}`;
  };
  return (
    <>
      <PageHeader title="Audit log" description="Every change recorded in the system: who, what, which record and when."
        actions={<Link href={`/admin/audit/export${qs({ page: "" })}`} prefetch={false} className="text-sm font-semibold text-primary hover:underline">Export (CSV)</Link>} />
      <form className="mb-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Person"><Input name="who" defaultValue={f.who ?? ""} placeholder="Name" /></Field>
        <Field label="Kind of record"><NativeSelect name="type" value={f.type ?? ""} placeholder="Any" options={types.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} /></Field>
        <Field label="Record number"><Input name="id" inputMode="numeric" defaultValue={f.id ?? ""} /></Field>
        <Field label="Text"><Input name="q" defaultValue={f.q ?? ""} placeholder="e.g. approved" /></Field>
        <Field label="From"><Input type="date" name="from" defaultValue={f.from ?? ""} /></Field>
        <Field label="To"><Input type="date" name="to" defaultValue={f.to ?? ""} /></Field>
        <div className="flex items-end gap-2"><Button variant="secondary">Search</Button><Link href="/admin/audit" className="text-sm text-muted hover:underline">Clear</Link></div>
      </form>
      <Panel title={`${formatNumber(total)} entr${total === 1 ? "y" : "ies"}`} padded={false}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-sunken text-left text-muted"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Record</th><th className="px-3 py-2">What</th></tr></thead>
          <tbody>{rows.map((r) => { const h = recordHref(r.entityType, r.entityId); return (
            <tr key={r.id} className="border-t border-line align-top">
              <td className="whitespace-nowrap px-3 py-2">{formatDateTime(r.at)}</td><td className="px-3 py-2">{r.actor ?? "System"}</td>
              <td className="whitespace-nowrap px-3 py-2">{h ? <Link href={h} className="text-primary hover:underline">{r.entityType.replace(/_/g, " ")} {r.entityId}</Link> : `${r.entityType.replace(/_/g, " ")} ${r.entityId || ""}`}</td>
              <td className="px-3 py-2"><span className="text-muted">{r.action.replace(/_/g, " ")}:</span> {r.summary}</td>
            </tr>); })}</tbody>
        </table></div>
        <div className="flex justify-between border-t border-line px-3 py-2 text-sm">
          {page > 0 ? <Link href={qs({ page: page - 1 })} className="text-primary hover:underline">‹ Newer</Link> : <span />}
          {(page + 1) * PAGE < total ? <Link href={qs({ page: page + 1 })} className="text-primary hover:underline">Older ›</Link> : <span />}
        </div>
      </Panel>
    </>
  );
}
