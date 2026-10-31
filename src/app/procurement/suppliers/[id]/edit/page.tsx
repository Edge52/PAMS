import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { PageHeader, Panel } from "@/components/ui";
import { SupplierForm } from "@/components/procurement/supplier-form";
import { updateSupplier } from "../../actions";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit supplier" };

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("procurement.view");
  await requirePermission("suppliers.edit");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) notFound();
  return (
    <>
      <PageHeader title={`Edit ${s.name}`} back={{ href: `/procurement/suppliers/${id}`, label: s.name }} />
      <Panel><SupplierForm action={updateSupplier.bind(null, id)} supplier={s} submitLabel="Save supplier" /></Panel>
    </>
  );
}
