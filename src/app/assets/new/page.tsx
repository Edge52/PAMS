import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, floors, rooms } from "@/db/schema";
import { Button, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { DeviceTypeSelect, enumOptions, NativeSelect, RoomSelect, SubmitRow } from "@/components/assets/bits";
import { ASSET_CONDITIONS, ASSET_STATUSES } from "@/lib/assets/filters";
import { deviceTypeOptions, listFacilities, locationTree } from "@/lib/assets/queries";
import { CURRENCIES, todayISO } from "@/lib/format";
import { createAssetAction } from "../actions";
import { ModelDatalists } from "@/components/assets/model-datalists";
import { SizeFields } from "@/components/assets/size-fields";
import { modelSuggestions } from "@/lib/assets/models-server";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Register asset" };

const n = (v: string | string[] | undefined) => { const s = Array.isArray(v) ? v[0] : v; return s && /^\d+$/.test(s) ? Number(s) : null; };

export default async function NewAssetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("assets.view");
  const me = await requirePermission("assets.edit");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const roomId = n(sp.roomId), deviceTypeId = n(sp.deviceTypeId);
  const facs = await listFacilities(scope);
  if (!facs.length) {
    return (<><PageHeader title="Register asset" back={{ href: "/assets", label: "Asset register" }} />
      <EmptyState title="No facility to register into" action={<LinkButton href="/facilities" variant="primary">Go to facilities</LinkButton>}>Assets are registered to a facility and placed in its rooms. Add a facility first, or ask an administrator for access to one.</EmptyState></>);
  }
  let facilityId = n(sp.facilityId) ?? facs[0].id;
  if (roomId) {
    const [r] = await db.select({ fac: buildings.facilityId }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(rooms.id, roomId));
    if (r) facilityId = r.fac;
  }
  await requireFacilityAccess(facilityId, me);
  const [tree, types] = await Promise.all([locationTree(facilityId, scope), deviceTypeOptions()]);
  return (
    <>
      <PageHeader title="Register asset" back={{ href: "/assets", label: "Asset register" }}
        description="One device. The tag is generated, and criticality, life expectancy and warranty end come from the device type and dates."
        actions={<LinkButton href="/assets/bulk">Placing many of the same? Use bulk placement</LinkButton>} />
      <ActionForm action={createAssetAction} className="space-y-5">
        <Panel title="What it is">
          <FormGrid cols={3}>
            <Field label="Device type" className="sm:col-span-2 lg:col-span-3"><DeviceTypeSelect types={types} value={deviceTypeId} required /></Field>
            <Field label="Manufacturer"><Input name="manufacturer" placeholder="Philips" list="dl-makers" autoComplete="off" /></Field>
            <Field label="Model" hint={<><Link href="/catalogue/models" className="text-primary hover:underline">Makes and models</Link> in the catalogue are offered as you type.</>}><Input name="model" placeholder="IntelliVue MX750" list="dl-models" autoComplete="off" /></Field>
            <ModelDatalists {...await modelSuggestions()} />
            <Field label="Serial number" hint="Must be unique in the register"><Input name="serialNumber" /></Field>
          </FormGrid>
        </Panel>
        <Panel title="Where it is">
          <FormGrid cols={3}>
            <Field label="Facility">
              {facs.length > 1 ? <NativeSelect name="facilityId" options={facs.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }))} value={facilityId} required />
                : <><input type="hidden" name="facilityId" value={facilityId} /><Input value={`${facs[0].code} — ${facs[0].name}`} readOnly disabled /></>}
            </Field>
            <Field label="Room" hint="The department follows the room"><RoomSelect tree={tree} value={roomId} placeholder="No room yet (in store)" /></Field>
            <Field label="Department" hint="Only needed when there is no room yet"><NativeSelect name="departmentId" options={tree.departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="From the room" /></Field>
          </FormGrid>
        </Panel>
        <Panel title="Status, dates and cost">
          <FormGrid cols={4}>
            <Field label="Status" hint="Blank: in service with a room, else in stock"><NativeSelect name="status" options={enumOptions(ASSET_STATUSES)} placeholder="Automatic" /></Field>
            <Field label="Condition"><NativeSelect name="condition" options={enumOptions(ASSET_CONDITIONS)} value="NEW" /></Field>
            <Field label="Purchase date"><Input type="date" name="purchaseDate" max={todayISO()} /></Field>
            <Field label="Install date"><Input type="date" name="installDate" defaultValue={todayISO()} /></Field>
            <Field label="Warranty months" hint="From install date"><Input type="number" name="warrantyMonths" min={0} max={240} defaultValue={24} /></Field>
            <Field label="Warranty end" hint="Overrides warranty months"><Input type="date" name="warrantyEnd" /></Field>
            <Field label="Purchase cost"><Input type="number" name="purchaseCost" min={0} step="0.01" /></Field>
            <Field label="Currency"><NativeSelect name="currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} value="USD" /></Field>
            <Field label="Part of (parent asset tag)" hint="e.g. the workstation this monitor is mounted on"><Input name="parentTag" placeholder="DGH-LIF-000123" className="uppercase" /></Field>
            <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" rows={2} /></Field>
          </FormGrid>
        </Panel>
        <Panel title="Size">
          <SizeFields />
        </Panel>
        <SubmitRow><Button>Register asset</Button><LinkButton href="/assets" variant="ghost">Cancel</LinkButton></SubmitRow>
      </ActionForm>
    </>
  );
}
