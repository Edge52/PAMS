import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { BulkForm } from "@/components/assets/bulk-form";
import { ModelDatalists } from "@/components/assets/model-datalists";
import { modelSuggestions } from "@/lib/assets/models-server";
import { ASSET_STATUSES } from "@/lib/assets/filters";
import { deviceTypeOptions, listFacilities, locationTree } from "@/lib/assets/queries";
import { CURRENCIES, todayISO } from "@/lib/format";
import { bulkCreateAction } from "../actions";
import { facilityScope, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk placement" };

const n = (v: string | string[] | undefined) => { const s = Array.isArray(v) ? v[0] : v; return s && /^\d+$/.test(s) ? Number(s) : null; };

export default async function BulkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("assets.view");
  const me = await requirePermission("assets.edit");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const [facs, tree, types] = await Promise.all([listFacilities(scope), locationTree(undefined, scope), deviceTypeOptions()]);
  if (!facs.length || !tree.departments.length) {
    return (<><PageHeader title="Bulk placement" back={{ href: "/assets", label: "Asset register" }} />
      <EmptyState title="Set up departments and rooms first" action={<LinkButton href="/facilities" variant="primary">Go to facilities</LinkButton>}>Bulk placement spreads units across a department&apos;s rooms.</EmptyState></>);
  }
  const departments = tree.departments.map((d) => ({
    id: d.id, facilityId: d.facilityId, name: d.name, code: d.code,
    rooms: tree.rooms.filter((r) => r.departmentId === d.id).map((r) => ({ id: r.id, code: r.code, name: r.name, beds: r.beds, type: r.type })),
  }));
  return (
    <>
      <PageHeader title="Bulk placement" back={{ href: "/assets", label: "Asset register" }}
        description="Register many units of one device type and place them across a department's rooms in one go — for example 12 monitors, one at each ICU bed." />
      <BulkForm facilities={facs} departments={departments} types={types} statuses={[...ASSET_STATUSES]} currencies={CURRENCIES}
        initial={{ deviceTypeId: n(sp.deviceTypeId), departmentId: n(sp.departmentId), today: todayISO() }} action={bulkCreateAction} />
      <ModelDatalists {...await modelSuggestions()} />
    </>
  );
}
