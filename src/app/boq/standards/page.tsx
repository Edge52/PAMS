import Link from "next/link";
import { desc, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boqRules, boqs, standardSets } from "@/db/schema";
import { Badge, Button, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { Notice } from "@/components/boq/notice";
import { formatDate, formatNumber } from "@/lib/format";
import { setDefaultSet } from "./actions";

import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Standards & ratios" };

export default async function StandardsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const me = await requirePermission("boq.view");
  const mayEdit = can(me.role, "standards.edit");
  const sp = await searchParams;
  const ruleCounts = db.select({
    setId: boqRules.standardSetId,
    rules: sql<number>`count(*)::int`.as("rules"),
    deptTypes: sql<number>`count(distinct ${boqRules.departmentTypeCode})::int`.as("dept_types"),
    sourced: sql<number>`count(*) filter (where ${boqRules.confidence} = 'SOURCED')::int`.as("sourced"),
    draft: sql<number>`count(*) filter (where ${boqRules.confidence} = 'DRAFT')::int`.as("draft"),
  }).from(boqRules).groupBy(boqRules.standardSetId).as("rc");
  const boqCounts = db.select({ setId: boqs.standardSetId, n: sql<number>`count(*)::int`.as("n") }).from(boqs).groupBy(boqs.standardSetId).as("bc");
  const sets = await db.select({
    set: standardSets, rules: ruleCounts.rules, deptTypes: ruleCounts.deptTypes, sourced: ruleCounts.sourced, draft: ruleCounts.draft, boqs: boqCounts.n,
  }).from(standardSets)
    .leftJoin(ruleCounts, eq(ruleCounts.setId, standardSets.id))
    .leftJoin(boqCounts, eq(boqCounts.setId, standardSets.id))
    .orderBy(desc(standardSets.isDefault), asc(standardSets.name));

  return (
    <>
      <PageHeader title="Standards & ratios"
        description="Each standard set is a list of rules such as “1 ventilator per ICU bed” or “1 mobile X-ray per 100 hospital beds”. BOQs are generated from one set. Duplicate a set to build your own house standard." />
      <Notice notice={sp.notice} error={sp.error} />
      {sets.length === 0 ? (
        <EmptyState title="No standard sets loaded" action={<LinkButton href="/boq" variant="secondary">Back to BOQs</LinkButton>}>
          Standard sets are loaded from seed-data/boq-standards.json with the database seed. Once a set exists you can duplicate and edit it here.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sets.map(({ set, rules, deptTypes, sourced, draft, boqs: used }) => (
            <article key={set.id} className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold">
                    <Link href={`/boq/standards/${set.id}`} className="hover:text-primary hover:underline">{set.name}</Link>
                  </h2>
                  <p className="text-xs text-muted"><span className="font-mono">{set.code}</span> · v{set.version} · added {formatDate(set.createdAt)}</p>
                </div>
                {set.isDefault ? <Badge tone="primary">Default</Badge> : mayEdit && (
                  <form action={setDefaultSet}>
                    <input type="hidden" name="setId" value={set.id} /><input type="hidden" name="back" value="list" />
                    <Button variant="ghost" className="text-xs">Set as default</Button>
                  </form>
                )}
              </div>
              {set.description && <p className="mt-2 text-sm text-muted">{set.description}</p>}
              <dl className="mt-3 grid grid-cols-4 gap-2 text-sm">
                <div><dt className="text-xs text-muted">Rules</dt><dd className="font-semibold">{formatNumber(rules ?? 0)}</dd></div>
                <div><dt className="text-xs text-muted">Departments</dt><dd className="font-semibold">{formatNumber(deptTypes ?? 0)}</dd></div>
                <div><dt className="text-xs text-muted">Sourced</dt><dd className="font-semibold">{formatNumber(sourced ?? 0)}</dd></div>
                <div><dt className="text-xs text-muted">Draft</dt><dd className="font-semibold">{formatNumber(draft ?? 0)}</dd></div>
              </dl>
              {(set.sources?.length ?? 0) > 0 && (
                <div className="mt-3 text-sm">
                  <p className="text-xs text-muted">Sources</p>
                  <ul className="mt-0.5 list-inside list-disc text-[13px]">
                    {set.sources!.slice(0, 4).map((s) => <li key={s.id} className="truncate">{s.title}{s.year ? ` (${s.year})` : ""}</li>)}
                    {set.sources!.length > 4 && <li className="list-none text-muted">+{set.sources!.length - 4} more</li>}
                  </ul>
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <LinkButton href={`/boq/standards/${set.id}`}>Open rules</LinkButton>
                <span className="text-xs text-muted">{used ? `Used by ${used} BOQ${used === 1 ? "" : "s"}` : "Not used yet"}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
