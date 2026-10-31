import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, suppliers } from "@/db/schema";
import { Button, Field, PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect } from "@/components/assets/bits";
import { ContractFields } from "@/components/assets/contract-fields";
import { scopeWhere } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { addMonthsISO, todayISO } from "@/lib/format";
import { createContractAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a service contract" };

export default async function NewContractPage() {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const [facs, sups] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
  ]);
  const today = todayISO();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add a service contract" back={{ href: "/assets/contracts", label: "Service contracts" }}
        description="Record the contract first; you add the devices it covers on the next page." />
      {!can(me.role, "contracts.edit") ? <p className="text-sm text-muted">Your account can&apos;t add contracts. Ask the biomedical or procurement team.</p> : (
        <Panel>
          <ActionForm action={createContractAction} className="space-y-4">
            <Field label="Hospital"><NativeSelect name="facilityId" required value={facs.length === 1 ? facs[0].id : undefined} placeholder="Choose a hospital…" options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
            <ContractFields suppliers={sups} v={{ startDate: today, endDate: addMonthsISO(today, 12) }} />
            <Button>Create contract</Button>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}
