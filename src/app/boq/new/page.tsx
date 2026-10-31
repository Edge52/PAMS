import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { boqRules, facilities, projects, standardSets } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { BoqCreateForm } from "@/components/boq/create-form";
import { CURRENCIES } from "@/lib/format";
import { PRESETS } from "@/lib/boq/presets";
import { departmentTypeList } from "@/lib/boq/queries";
import { createBoq, loadFacilityScope } from "../actions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "New BOQ" };

export default async function NewBoqPage({ searchParams }: { searchParams: Promise<{ facilityId?: string; projectId?: string }> }) {
  await requirePermission("boq.view");
  const me = await requirePermission("boq.edit");
  const sp = await searchParams;
  const scope = await facilityScope(me);
  const sets = await db.select({
    id: standardSets.id, name: standardSets.name, version: standardSets.version, isDefault: standardSets.isDefault,
    ruleCount: sql<number>`count(${boqRules.id})::int`,
  }).from(standardSets).leftJoin(boqRules, eq(boqRules.standardSetId, standardSets.id))
    .groupBy(standardSets.id).orderBy(desc(standardSets.isDefault), asc(standardSets.name));

  if (sets.length === 0) {
    return (
      <>
        <PageHeader title="New BOQ" back={{ href: "/boq", label: "BOQs" }} />
        <EmptyState title="No standard set yet"
          action={<LinkButton href="/boq/standards" variant="primary">Go to standards & ratios</LinkButton>}>
          A BOQ is generated from a standard set of ratio rules (e.g. &ldquo;1 ventilator per ICU bed&rdquo;). Load or create one first.
        </EmptyState>
      </>
    );
  }

  const [facs, projs, deptTypes] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name, code: facilities.code }).from(facilities)
      .where(scope ? inArray(facilities.id, scope.length ? scope : [-1]) : undefined).orderBy(asc(facilities.name)),
    db.select({ id: projects.id, code: projects.code, title: projects.title, facilityId: projects.facilityId }).from(projects)
      .where(scopeWhere(projects.facilityId, scope)).orderBy(desc(projects.createdAt)),
    departmentTypeList(),
  ]);

  return (
    <>
      <PageHeader title="New BOQ" back={{ href: "/boq", label: "BOQs" }}
        description="Describe the departments to equip. Quantities are calculated from the standard set's ratios, and every line shows how it was worked out." />
      <BoqCreateForm
        action={createBoq}
        loadFacility={loadFacilityScope}
        standardSets={sets.map((s) => ({ value: s.id, label: `${s.name} v${s.version}`, isDefault: s.isDefault, ruleCount: s.ruleCount }))}
        facilities={facs.map((f) => ({ value: f.id, label: `${f.name} (${f.code})` }))}
        projects={projs.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}`, facilityId: p.facilityId }))}
        departmentTypes={deptTypes.map((d) => ({ value: d.code, label: `${d.name} (${d.code})` }))}
        presets={PRESETS}
        currencies={CURRENCIES}
        initialFacilityId={sp.facilityId ? Number(sp.facilityId) || null : null}
        initialProjectId={sp.projectId ? Number(sp.projectId) || null : null}
      />
    </>
  );
}
