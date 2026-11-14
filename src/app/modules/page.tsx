import Link from "next/link";
import { and, count, eq, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, buildings, facilities, floors, patientFlows, projects, purchaseOrders, rooms, workOrders } from "@/db/schema";
import { permissionsOf } from "@/lib/auth/permissions";
import { facilityScope, requireUser } from "@/lib/auth/session";
import { pendingForUser } from "@/lib/approvals/server";
import { formatNumber } from "@/lib/format";
import { modulesFor, orderModules, type ModuleId } from "@/lib/modules";
import { Icon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modules" };

const OPEN_PROJECT = ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION", "AWARDED", "DELIVERY"] as const;
const OPEN_PO = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED"] as const;

/** Modules home (wave 21): one card per module the user may open, each with one live figure. */
export default async function ModulesPage() {
  const me = await requireUser();
  const scope = await facilityScope(me);
  const own = (col: PgColumn): SQL | undefined => (scope === null ? undefined : scope.length ? inArray(col, scope) : sql`false`);
  const ownOrNone = (col: PgColumn): SQL | undefined => (scope === null ? undefined : or(isNull(col), scope.length ? inArray(col, scope) : sql`false`));
  const modules = orderModules(modulesFor(permissionsOf(me.role)), me.role);
  const has = (id: ModuleId) => modules.some((m) => m.id === id);
  const n = async (q: Promise<{ n: number }[]> | null) => (q ? (await q)[0]?.n ?? 0 : 0);

  const [assetCount, openJobs, openProjects, openPos, roomCount, flowCount, facs, waiting] = await Promise.all([
    n(has("assets") ? db.select({ n: count() }).from(assets).where(and(sql`${assets.status} <> 'DISPOSED'`, own(assets.facilityId))) : null),
    n(has("maintenance") ? db.select({ n: count() }).from(workOrders).where(and(notInArray(workOrders.status, ["COMPLETED", "CLOSED", "CANCELLED"]), own(workOrders.facilityId))) : null),
    n(has("procurement") ? db.select({ n: count() }).from(projects).where(and(inArray(projects.status, [...OPEN_PROJECT]), ownOrNone(projects.facilityId))) : null),
    n(has("finance") ? db.select({ n: count() }).from(purchaseOrders).where(and(inArray(purchaseOrders.status, [...OPEN_PO]), ownOrNone(purchaseOrders.facilityId))) : null),
    n(has("buildings") ? db.select({ n: count() }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(own(buildings.facilityId)) : null),
    n(has("pathways") ? db.select({ n: count() }).from(patientFlows).where(and(eq(patientFlows.status, "PUBLISHED"), own(patientFlows.facilityId))) : null),
    db.select({ name: facilities.name }).from(facilities).where(own(facilities.id)).orderBy(facilities.name),
    pendingForUser(me),
  ]);
  const figure: Partial<Record<ModuleId, { n: number; label: string }>> = {
    assets: { n: assetCount, label: "assets tracked" }, maintenance: { n: openJobs, label: "open jobs" },
    procurement: { n: openProjects, label: "open projects" }, finance: { n: openPos, label: "open purchase orders" },
    buildings: { n: roomCount, label: "rooms" }, pathways: { n: flowCount, label: "published pathways" },
  };

  return (
    <div className="-mx-5 -mt-3 md:-mx-8 lg:-mx-10">
      <header className="bg-nav px-5 pb-24 pt-10 text-white md:px-8 lg:px-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nav-gold">{facs.map((f) => f.name).join(" · ") || "No hospital yet"}</p>
        <h1 className="mt-2 font-display text-[40px] leading-tight tracking-tight sm:text-[46px]">Where would you like to work?</h1>
        <p className="mt-2 text-[15px] text-nav-ink">
          {modules.length} module{modules.length === 1 ? "" : "s"} for your role.
          {waiting.length > 0 && <> <Link href="/approvals" className="font-semibold text-nav-gold underline underline-offset-2">{waiting.length} approval{waiting.length === 1 ? "" : "s"} waiting for you</Link>.</>}
        </p>
      </header>
      <div className="-mt-16 grid gap-5 px-5 pb-10 sm:grid-cols-2 md:px-8 lg:px-10 xl:grid-cols-3">
        {modules.map((m) => {
          const f = figure[m.id];
          return (
            <section key={m.id} aria-labelledby={`module-${m.id}`} className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between gap-3">
                <span className="grid size-12 place-items-center rounded-[14px] bg-nav text-nav-gold"><Icon name={m.id} size={22} /></span>
                {f && <p className="flex items-baseline gap-2"><span className="font-display text-[30px] leading-none">{formatNumber(f.n)}</span><span className="text-[13px] text-muted">{f.label}</span></p>}
              </div>
              <h2 id={`module-${m.id}`} className="font-display text-[26px] leading-tight">
                <Link href={m.links[0].href} className="hover:text-primary">{m.name}</Link>
              </h2>
              <p className="min-h-10 text-sm text-muted">{m.description}</p>
              <ul className="flex flex-wrap gap-2">
                {m.links.map((l) => (
                  <li key={l.href}><Link href={l.href} className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-[13px] hover:border-primary hover:bg-primary-soft hover:text-primary-strong">{l.label}</Link></li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
