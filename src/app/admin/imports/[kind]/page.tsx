import { notFound } from "next/navigation";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/imports/import-wizard";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { IMPORT_KINDS, KIND_INFO, type ImportKind } from "@/lib/imports/kinds";
import { facilitiesFor } from "@/lib/imports/kinds-server";
import { commitKindImportAction, previewKindImportAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

const NOTES: Partial<Record<ImportKind, string>> = {
  users: "Accounts are made without passwords and can't sign in yet. Set a temporary password for each under Users › Reset password, or let them sign in with Microsoft or Google under the same email where that is switched on.",
  contracts: "Import the suppliers first. Contract numbers (SC-YYYY-NNNN) are given by PAMS; covered hours are set on each contract afterwards.",
  ppm: "Each row is one planned visit on one device. Visits already scheduled for the same device, type and date are refused.",
  parts: "The count in stock is booked as the first stock receipt, so the part's history starts with it.",
};

/** Wave 41: import one kind of record from CSV or Excel. */
export default async function KindImportPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind: k } = await params;
  if (!(IMPORT_KINDS as readonly string[]).includes(k)) notFound();
  const kind = k as ImportKind, info = KIND_INFO[kind];
  const me = await requirePermission(info.perm);
  const facs = info.perHospital ? await facilitiesFor(await facilityScope(me)) : [];
  const fields = info.perHospital ? (facs.length > 1
    ? <label className="block"><span className="mb-1 block text-sm font-semibold">Hospital</span>
        <select name="facilityId" className="rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px]">{facs.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}</select></label>
    : <input type="hidden" name="facilityId" value={facs[0]?.id ?? ""} />) : null;
  return (
    <>
      <PageHeader title={`Import ${info.title.toLowerCase()}`} back={{ href: "/admin/imports", label: "Data imports" }}
        description={`Load ${info.what} from Excel or CSV. Every row is checked first; only valid rows are imported.`} />
      {info.perHospital && !facs.length ? (
        <EmptyState title="No hospital to import into" action={<LinkButton href="/facilities" variant="primary">Go to facilities</LinkButton>}>Ask an administrator for access to a hospital.</EmptyState>
      ) : (
        <ImportWizard templateHref={`/admin/imports/${kind}/template`} columns={info.columns.map((c) => ({ key: c.key, header: c.header }))}
          preview={previewKindImportAction} commit={commitKindImportAction} again={`/admin/imports/${kind}`} what={info.what}
          fields={<><input type="hidden" name="kind" value={kind} />{fields}</>}
          note={NOTES[kind] ? <p className="mb-3 text-sm">{NOTES[kind]}</p> : undefined} />
      )}
    </>
  );
}
