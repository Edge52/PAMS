import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { facilities, offers, projects } from "@/db/schema";
import { EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DaysLeft } from "@/components/procurement/bits";
import { formatMoney } from "@/lib/format";
import { options, PROJECT_STATUSES, type ProjectStatus } from "@/lib/procurement/labels";
import { projectPoValues } from "@/lib/procurement/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects & tenders" };

const OPEN: ProjectStatus[] = ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION", "AWARDED", "DELIVERY"];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const me = await requirePermission("procurement.view");
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const q = sp.q?.trim() ?? "";

  const where: SQL[] = [];
  const scope = scopeWhere(projects.facilityId, await facilityScope(me));
  if (scope) where.push(scope);
  if (status === "open") where.push(sql`${projects.status} in ${OPEN}`);
  else if ((PROJECT_STATUSES as readonly string[]).includes(status)) where.push(eq(projects.status, status as ProjectStatus));
  if (q) {
    const like = `%${q}%`;
    where.push(or(ilike(projects.code, like), ilike(projects.title, like), ilike(projects.client, like), ilike(facilities.name, like))!);
  }

  const rows = await db.select({
    id: projects.id, code: projects.code, title: projects.title, client: projects.client, status: projects.status,
    currency: projects.currency, deadline: projects.submissionDeadline, facility: facilities.name, facilityCode: facilities.code,
    offerCount: sql<number>`(select count(*)::int from ${offers} where ${offers.projectId} = ${projects.id})`,
  }).from(projects).leftJoin(facilities, eq(facilities.id, projects.facilityId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${projects.submissionDeadline} asc nulls last`, desc(projects.id));
  const poValues = await projectPoValues(rows);
  const anyProjects = rows.length > 0 || (await db.select({ id: projects.id }).from(projects).where(scope).orderBy(asc(projects.id)).limit(1)).length > 0;
  const mayCreate = can(me.role, "procurement.edit");

  return (
    <>
      <PageHeader title="Projects & tenders"
        description="Every tender from specification to delivery: offers received, the evaluation, and what has been ordered."
        actions={mayCreate ? <LinkButton href="/procurement/new" variant="primary">New project</LinkButton> : undefined} />

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="min-w-0 flex-1 basis-60">
          <span className="sr-only">Search projects</span>
          <Input name="q" type="search" defaultValue={q} placeholder="Search code, title, client or facility" />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <Select name="status" defaultValue={status} className="w-auto"
            options={[{ value: "open", label: "Open projects" }, { value: "all", label: "All statuses" }, ...options(PROJECT_STATUSES)]} />
        </label>
        <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Apply filters</button>
        {(q || status !== "open") && <Link href="/procurement" className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        anyProjects ? (
          <EmptyState title="No projects match these filters" action={<LinkButton href="/procurement?status=all">Show all projects</LinkButton>}>
            Try another status or search term.
          </EmptyState>
        ) : (
          <EmptyState title="No projects yet" action={mayCreate ? <LinkButton href="/procurement/new" variant="primary">Create the first project</LinkButton> : undefined}>
            Create a project for each tender you run: then write the specifications, send RFQs, register offers and compare them.
          </EmptyState>
        )
      ) : (
        <Table>
          <THead><tr>
            <Th>Code</Th><Th>Title</Th><Th>Client</Th><Th>Facility</Th><Th>Status</Th><Th>Deadline</Th>
            <Th align="right">Offers</Th><Th align="right">PO value</Th>
          </tr></THead>
          <tbody>
            {rows.map((r) => {
              const po = poValues.get(r.id);
              const closed = r.status === "CLOSED" || r.status === "CANCELLED" || r.status === "AWARDED" || r.status === "DELIVERY";
              return (
                <tr key={r.id} className="hover:bg-sunken/50">
                  <Td className="whitespace-nowrap"><Link href={`/procurement/${r.id}`} className="font-semibold text-primary hover:underline">{r.code}</Link></Td>
                  <Td className="min-w-56"><Link href={`/procurement/${r.id}`} className="hover:text-primary">{r.title}</Link></Td>
                  <Td>{r.client ?? <span className="text-faint">—</span>}</Td>
                  <Td>{r.facility ? <span title={r.facility}>{r.facilityCode}</span> : <span className="text-faint">—</span>}</Td>
                  <Td><StatusBadge value={r.status} /></Td>
                  <Td className="whitespace-nowrap"><DaysLeft date={r.deadline} closedLabel={closed ? "submission closed" : undefined} /></Td>
                  <Td align="right">{r.offerCount}</Td>
                  <Td align="right" className="whitespace-nowrap">
                    {!po || po.count === 0 ? <span className="text-faint">—</span>
                      : po.total == null ? <span title="An exchange rate is missing">{formatMoney(po.partial, r.currency)}*</span>
                      : formatMoney(po.total, r.currency)}
                    {po && po.count > 0 && <span className="block text-xs text-muted">{po.count} PO{po.count === 1 ? "" : "s"}</span>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
