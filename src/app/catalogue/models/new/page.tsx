import { Button, PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { ModelFields } from "@/components/assets/model-fields";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { saveModelAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a make and model" };

export default async function NewModelPage({ searchParams }: { searchParams: Promise<{ deviceTypeId?: string; back?: string }> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const back = sp.back?.startsWith("/catalogue") ? sp.back : "/catalogue/models";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add a make and model" back={{ href: back, label: "Back" }}
        description="Models in the catalogue are offered when registering equipment, so the same model is always spelt the same way." />
      {!can(me.role, "catalogue.edit") ? <p className="text-sm text-muted">Your account can&apos;t edit the catalogue. Ask the biomedical team.</p> : (
        <Panel>
          <ActionForm action={saveModelAction} className="space-y-4">
            {sp.back && <input type="hidden" name="back" value={back} />}
            <ModelFields types={await deviceTypeOptions()} v={{ deviceTypeId: Number(sp.deviceTypeId) || null }} />
            <Button>Add model</Button>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}
