import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, offerLines, projects, specItems, techSpecs } from "@/db/schema";
import { Badge, LinkButton, PageHeader, Panel } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { ActivityPanel } from "@/components/procurement/bits";
import { SpecEditor } from "@/components/procurement/spec-editor";
import { deleteSpec, saveSpecItems } from "../actions";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SpecPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ spec: techSpecs, dt: deviceTypes, project: projects }).from(techSpecs)
    .innerJoin(deviceTypes, eq(deviceTypes.id, techSpecs.deviceTypeId))
    .leftJoin(projects, eq(projects.id, techSpecs.projectId))
    .where(eq(techSpecs.id, id));
  if (!row) notFound();
  const { spec, dt, project } = row;
  await requireFacilityAccess(project?.facilityId, me);
  const mayEdit = can(me.role, "specs.edit");
  const items = await db.select().from(specItems).where(eq(specItems.specId, id)).orderBy(asc(specItems.sortOrder), asc(specItems.id));
  const [{ n: offerLineCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(offerLines).where(eq(offerLines.specId, id));
  const sections = [...new Set(["General", "Technical", "Software", "Accessories", "General conditions", ...items.map((i) => i.section ?? "").filter(Boolean)])];

  return (
    <>
      <PageHeader
        back={project ? { href: `/procurement/${project.id}?tab=specs`, label: `${project.code} specifications` } : { href: "/procurement", label: "Projects" }}
        title={spec.title}
        description={<>
          <Link href={`/catalogue/${dt.code}`} className="text-primary hover:underline">{dt.name}</Link> · {dt.code} · version {spec.version}
          {offerLineCount > 0 && <> · used by {offerLineCount} offer line{offerLineCount === 1 ? "" : "s"}</>}
        </>}
        actions={<LinkButton href={`/procurement/specs/${id}/print`} variant="primary">Print spec sheet</LinkButton>}
      />
      {dt.nameAr && <p lang="ar" dir="rtl" className="-mt-4 mb-4 text-sm text-muted">{dt.nameAr}</p>}

      <div className="space-y-5">
        <Panel title={<span className="flex items-center gap-2">Parameters <Badge>{items.length}</Badge></span>}>
          {!mayEdit ? (
            <ul className="divide-y divide-line text-sm">
              {items.map((i) => (
                <li key={i.id} className="py-1.5"><span className="font-semibold">{i.parameter}</span>{i.mandatory && <span className="text-xs text-danger"> mandatory</span>}
                  <span className="block text-xs text-muted">{i.section ? `${i.section} · ` : ""}{i.requirement}{i.unit ? ` (${i.unit})` : ""} · weight {i.weight}</span></li>
              ))}
            </ul>
          ) : <SpecEditor
            action={saveSpecItems.bind(null, id)}
            title={spec.title}
            notes={spec.notes ?? ""}
            sections={sections}
            items={items.map((i) => ({
              id: i.id, section: i.section ?? "", parameter: i.parameter, requirement: i.requirement, unit: i.unit ?? "",
              mandatory: i.mandatory, weight: i.weight,
            }))}
          />}
        </Panel>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <DocumentsPanel entityType="spec" entityId={id} returnPath={`/procurement/specs/${id}`} title="Reference documents" />
          <ActivityPanel entityType="spec" entityId={id} />
        </div>

        {mayEdit && <Panel title="Delete specification">
          <ActionForm action={deleteSpec} className="flex flex-wrap items-center gap-3"
            confirm="Delete this specification? Compliance answers recorded against it on offers will be removed.">
            <input type="hidden" name="specId" value={id} />
            <p className="flex-1 text-sm text-muted">Removes the specification and every compliance answer recorded against it. Offers themselves are kept.</p>
            <SubmitButton variant="danger">Delete specification</SubmitButton>
          </ActionForm>
        </Panel>}
      </div>
    </>
  );
}
