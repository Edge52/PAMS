import { PageHeader, Panel } from "@/components/ui";
import { SupplierForm } from "@/components/procurement/supplier-form";
import { createSupplier } from "../actions";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  await requirePermission("procurement.view");
  await requirePermission("suppliers.edit");
  return (
    <>
      <PageHeader title="New supplier" back={{ href: "/procurement/suppliers", label: "Suppliers" }}
        description="Agents, distributors and manufacturers you invite to quote." />
      <Panel><SupplierForm action={createSupplier} submitLabel="Add supplier" /></Panel>
    </>
  );
}
