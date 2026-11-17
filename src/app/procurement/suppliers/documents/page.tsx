import Link from "next/link";
import { Badge, EmptyState, Field, LinkButton, PageHeader, Select, Stat, Table, Td, Th, THead } from "@/components/ui";
import { requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { DOC_EXPIRING_DAYS, DOC_NOTIFY_DAYS, DOC_STATE_LABELS, DOC_STATE_TONE, docTypeLabel, expiringList, expiryText } from "@/lib/procurement/supplier-docs";
import { expiringSupplierDocs } from "@/lib/procurement/supplier-docs-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplier documents" };

const WINDOWS = [30, 60, 90, 180];

/** Supplier licences, registrations and certificates that have expired or expire soon (wave 27). */
export default async function SupplierDocumentsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requirePermission("procurement.view");
  const asked = Number((await searchParams).days);
  const days = WINDOWS.includes(asked) ? asked : DOC_EXPIRING_DAYS;
  const today = todayISO();
  const rows = expiringList(await expiringSupplierDocs(days, today), today, days);
  const expired = rows.filter((r) => r.expiry.state === "EXPIRED");
  const soon = rows.filter((r) => r.expiry.state === "EXPIRING");
  const suppliers = new Set(rows.map((r) => r.supplierId)).size;

  return (
    <>
      <PageHeader title="Supplier documents" back={{ href: "/procurement/suppliers", label: "Suppliers" }}
        description={`Licences, EDA registrations, ISO 13485 and other certificates that have expired or expire in the next ${days} days. Procurement is told ${DOC_NOTIFY_DAYS} days before each one expires.`} />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Expiring within"><Select name="days" defaultValue={String(days)} options={WINDOWS.map((d) => ({ value: String(d), label: `${d} days` }))} className="w-auto" /></Field>
        <button className="min-h-9 rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:border-primary">Show</button>
      </form>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Expired" value={expired.length} hint="Still on file, not renewed" />
        <Stat label={`Expiring in ${days} days`} value={soon.length} />
        <Stat label="Suppliers concerned" value={suppliers} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing expiring" action={<LinkButton href="/procurement/suppliers">Open suppliers</LinkButton>}>
          No supplier document has expired or expires in the next {days} days. Add expiry dates to documents on each supplier&apos;s page so they show here.
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Supplier</Th><Th>Document</Th><Th>Type</Th><Th>Valid until</Th><Th>State</Th></tr></THead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/procurement/suppliers/${r.supplierId}`} className="font-semibold text-primary hover:underline">{r.supplierName}</Link></Td>
                <Td className="max-w-64 truncate"><a href={r.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{r.fileName}</a></Td>
                <Td>{docTypeLabel(r.kind)}</Td>
                <Td className="whitespace-nowrap">{expiryText(r.expiry, formatDate(r.expiresOn))}</Td>
                <Td><Badge tone={DOC_STATE_TONE[r.expiry.state]}>{DOC_STATE_LABELS[r.expiry.state]}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
