import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { PageHeader, Panel } from "@/components/ui";
import { ProjectForm } from "@/components/procurement/project-form";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { createProject } from "../actions";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  await requirePermission("procurement.view");
  const me = await requirePermission("procurement.edit");
  const scope = await facilityScope(me);
  const facs = await db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities)
    .where(scope ? inArray(facilities.id, scope.length ? scope : [-1]) : undefined).orderBy(asc(facilities.name));
  return (
    <>
      <PageHeader title="New project or tender" back={{ href: "/procurement", label: "Projects & tenders" }}
        description="One project per tender or purchase. Specifications, RFQs, offers, the evaluation and purchase orders all hang off it." />
      <Panel><ProjectForm action={createProject} facilities={facs} submitLabel="Create project" /></Panel>
    </>
  );
}
