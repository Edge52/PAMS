import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ImportFlow } from "@/components/assets/import-flow";
import { listFacilities } from "@/lib/assets/queries";
import { commitImportAction, previewImportAction } from "../actions";
import { facilityScope, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import assets" };

export default async function ImportPage() {
  await requirePermission("assets.view");
  const me = await requirePermission("assets.edit");
  const facs = await listFacilities(await facilityScope(me));
  return (
    <>
      <PageHeader title="Import assets from Excel" back={{ href: "/assets", label: "Asset register" }}
        description="Check every row against the catalogue and the rooms first, then import only the valid ones." />
      {facs.length === 0
        ? <EmptyState title="No facility to import into" action={<LinkButton href="/facilities" variant="primary">Go to facilities</LinkButton>}>Imported assets are placed in a facility&apos;s rooms. Add a facility first, or ask an administrator for access to one.</EmptyState>
        : <ImportFlow facilities={facs} preview={previewImportAction} commit={commitImportAction} />}
    </>
  );
}
