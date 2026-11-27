import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { ImportWizard } from "@/components/imports/import-wizard";
import { requirePermission } from "@/lib/auth/session";
import { GUIDELINE_COLUMNS } from "@/lib/boq/guideline";
import { guidelineSets } from "@/lib/boq/guideline-server";
import { formatDate } from "@/lib/format";
import { commitGuidelineAction, previewGuidelineAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "National guideline import" };

/** Wave 41: load GAHAR's National Medical Equipment Guideline (2025 app) from a template as a standard set. */
export default async function GuidelinePage() {
  await requirePermission("boq.view");
  await requirePermission("standards.edit");
  const sets = await guidelineSets();
  return (
    <>
      <PageHeader title="Import the national equipment guideline" back={{ href: "/boq/standards", label: "Standards & ratios" }}
        description="GAHAR's National Medical Equipment Guideline is published in its own app, which PAMS can't read. Copy its tables into the template, then load them here as a standard set. Each BOQ can then be compared with it." />
      {sets.length > 0 && (
        <Panel title="Imported so far" className="mb-5">
          <ul className="text-sm">{sets.map((s) => <li key={s.id}><Link href={`/boq/standards/${s.id}`} className="text-primary hover:underline">{s.name}</Link> <span className="text-muted">· {s.code} · {formatDate(s.updatedAt)}</span></li>)}</ul>
          <p className="mt-2 text-xs text-muted">Importing the same version again replaces its rules.</p>
        </Panel>
      )}
      <ImportWizard templateHref="/boq/standards/guideline/template" columns={GUIDELINE_COLUMNS.map((c) => ({ key: c.key, header: c.header }))}
        preview={previewGuidelineAction} commit={commitGuidelineAction} again="/boq/standards/guideline" what="rows" />
    </>
  );
}
