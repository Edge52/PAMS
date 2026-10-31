import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, facilities, projects, specItems, techSpecs } from "@/db/schema";
import { LinkButton } from "@/components/ui";
import { PrintStyles } from "@/components/procurement/bits";
import { PrintButton } from "@/components/procurement/print-button";
import { formatDate, todayISO } from "@/lib/format";

import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Spec sheet as it goes into the tender booklet: numbered, grouped by section, with a bidder compliance column. */
export default async function SpecPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ spec: techSpecs, dt: deviceTypes, project: projects, facility: facilities }).from(techSpecs)
    .innerJoin(deviceTypes, eq(deviceTypes.id, techSpecs.deviceTypeId))
    .leftJoin(projects, eq(projects.id, techSpecs.projectId))
    .leftJoin(facilities, eq(facilities.id, projects.facilityId))
    .where(eq(techSpecs.id, id));
  if (!row) notFound();
  await requireFacilityAccess(row.project?.facilityId, me);
  const { spec, dt, project, facility } = row;
  const items = await db.select().from(specItems).where(eq(specItems.specId, id)).orderBy(asc(specItems.sortOrder), asc(specItems.id));

  const groups: { section: string; items: typeof items }[] = [];
  for (const i of items) {
    const s = i.section || "General";
    const g = groups.at(-1);
    if (g && g.section === s) g.items.push(i); else groups.push({ section: s, items: [i] });
  }
  let n = 0;

  return (
    <>
      <PrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href={`/procurement/specs/${id}`}>Back to editing</LinkButton>
        <PrintButton label="Print spec sheet" />
        <span className="text-sm text-muted">Use your browser&apos;s “Save as PDF” to attach it to the tender booklet.</span>
      </div>

      <article className="print-sheet mx-auto max-w-[210mm] rounded-[var(--radius-panel)] border border-line bg-surface p-8 text-[13px] leading-snug">
        <header className="mb-5 border-b-2 border-ink pb-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs text-muted">{project ? `${project.client ? `${project.client} · ` : ""}Tender ${project.code}` : "Technical specification"}</p>
              <h1 className="mt-1 text-xl font-bold">{spec.title}</h1>
              <p className="mt-0.5">{dt.name}{dt.nameAr && <span lang="ar" dir="rtl" className="ms-2">{dt.nameAr}</span>}</p>
            </div>
            <div className="text-right text-xs text-muted">
              <p>Version {spec.version}</p>
              <p>Issued {formatDate(todayISO())}</p>
              {facility && <p>{facility.name}</p>}
            </div>
          </div>
          {project && <p className="mt-2 text-xs">Project: {project.title}</p>}
        </header>

        <p className="mb-4 text-xs">
          Bidders shall state the offered value for every parameter and reference the page of the original catalogue or datasheet that proves it.
          Parameters marked <strong>M</strong> are mandatory: failing any of them makes the offer technically non-responsive.
        </p>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-sunken text-left">
              <th className="w-8 border border-line px-1.5 py-1">No.</th>
              <th className="w-44 border border-line px-1.5 py-1">Parameter</th>
              <th className="border border-line px-1.5 py-1">Required</th>
              <th className="w-8 border border-line px-1.5 py-1 text-center">M</th>
              <th className="w-36 border border-line px-1.5 py-1">Offered (bidder)</th>
              <th className="w-16 border border-line px-1.5 py-1">Ref. page</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={`s-${g.section}-${g.items[0].id}`}><td colSpan={6} className="border border-line bg-sunken/60 px-1.5 py-1 font-semibold">{g.section}</td></tr>,
              ...g.items.map((i) => (
                <tr key={i.id}>
                  <td className="border border-line px-1.5 py-1 tabular-nums">{++n}</td>
                  <td className="border border-line px-1.5 py-1">{i.parameter}</td>
                  <td className="border border-line px-1.5 py-1">{i.requirement}{i.unit && !i.requirement.includes(i.unit) ? ` ${i.unit}` : ""}</td>
                  <td className="border border-line px-1.5 py-1 text-center">{i.mandatory ? "M" : ""}</td>
                  <td className="border border-line px-1.5 py-1" />
                  <td className="border border-line px-1.5 py-1" />
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {items.length === 0 && <p className="mt-4 text-muted">This specification has no parameters yet.</p>}
        {spec.notes && <p className="mt-4 whitespace-pre-line text-xs"><strong>Notes: </strong>{spec.notes}</p>}

        <footer className="avoid-break mt-10 grid grid-cols-2 gap-10 text-xs">
          <div><p className="mb-10">Prepared by (biomedical engineering)</p><p className="border-t border-ink pt-1">Name, signature and date</p></div>
          <div><p className="mb-10">Bidder&apos;s stamp and signature</p><p className="border-t border-ink pt-1">Company, name, signature and date</p></div>
        </footer>
      </article>
    </>
  );
}
