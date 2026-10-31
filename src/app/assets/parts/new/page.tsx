import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, suppliers } from "@/db/schema";
import { Button, Field, Input, PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect } from "@/components/assets/bits";
import { PartFields } from "@/components/assets/part-fields";
import { scopeWhere } from "@/lib/assets/access";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { createPartAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a spare part" };

export default async function NewPartPage({ searchParams }: { searchParams: Promise<{ deviceTypeId?: string }> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const [facs, sups, types] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
    deviceTypeOptions(),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add a spare part" back={{ href: "/assets/parts", label: "Spare parts" }} />
      {!can(me.role, "parts.edit") ? <p className="text-sm text-muted">Your account can&apos;t add parts. Ask the biomedical team.</p> : (
        <Panel>
          <ActionForm action={createPartAction} className="space-y-4">
            <Field label="Hospital store"><NativeSelect name="facilityId" required value={facs.length === 1 ? facs[0].id : undefined} placeholder="Choose a hospital…" options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
            <PartFields types={types} suppliers={sups} v={{ deviceTypeId: Number(sp.deviceTypeId) || null }} />
            <Field label="Opening stock"><Input type="number" name="openingStock" min={0} defaultValue={0} className="max-w-40" /></Field>
            <Button>Add part</Button>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}
