import Link from "next/link";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, facilities, roundItems, rounds } from "@/db/schema";
import { Badge, Button, EmptyState, Field, PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { startRoundAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rounds and stock-take" };

export default async function RoundsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Rounds and stock-take" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const [list, depts] = await Promise.all([
    db.select({ r: rounds, dept: departments.name, n: sql<number>`(select count(*)::int from ${roundItems} where ${roundItems.roundId} = ${rounds.id})`,
      missing: sql<number>`(select count(*)::int from ${roundItems} where ${roundItems.roundId} = ${rounds.id} and ${roundItems.result} = 'MISSING')`,
      faults: sql<number>`(select count(*)::int from ${roundItems} where ${roundItems.roundId} = ${rounds.id} and ${roundItems.result} = 'FAULT')` })
      .from(rounds).leftJoin(departments, eq(departments.id, rounds.departmentId)).where(and(eq(rounds.facilityId, facilityId))).orderBy(desc(rounds.startedAt)).limit(100),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name)),
  ]);
  const canRun = can(me.role, "assets.move");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Rounds and stock-take" description="On a phone: scan each device's label, mark it OK, faulty or moved. A stock-take lists what wasn't found. Works with a weak signal: results are sent when it returns." />
      {facs.length > 1 && (
        <form className="mb-4 flex items-end gap-2"><Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field><Button variant="secondary">Show</Button></form>
      )}
      {canRun && (
        <Panel title="Start" className="mb-6">
          <ActionForm action={startRoundAction} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="facilityId" value={facilityId} />
            <p className="text-sm text-muted sm:col-span-2">In {facs.find((f) => f.id === facilityId)?.name}</p>
            <Field label="Ward or department"><NativeSelect name="departmentId" placeholder="Whole hospital" options={depts.map((d) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Kind"><NativeSelect name="kind" value="ROUND" options={[{ value: "ROUND", label: "Round" }, { value: "STOCKTAKE", label: "Stock-take" }]} /></Field>
            <div><Button>Start</Button></div>
          </ActionForm>
        </Panel>
      )}
      {list.length === 0 ? <EmptyState title="No rounds yet">Start one above, on the phone you&apos;ll carry.</EmptyState> : (
        <Panel padded={false}>
          <ul className="divide-y divide-line text-sm">{list.map((x) => (
            <li key={x.r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span><Link href={`/assets/rounds/${x.r.id}`} className="font-semibold text-primary hover:underline">{x.r.kind === "STOCKTAKE" ? "Stock-take" : "Round"}: {x.dept ?? "whole hospital"}</Link>
                <span className="block text-xs text-muted">{x.r.startedByName}, {formatDateTime(x.r.startedAt)} · {x.n} checked{x.faults ? ` · ${x.faults} faults` : ""}{x.missing ? ` · ${x.missing} missing` : ""}</span></span>
              <Badge tone={x.r.finishedAt ? "ok" : "warn"}>{x.r.finishedAt ? "Finished" : "In progress"}</Badge>
            </li>
          ))}</ul>
        </Panel>
      )}
    </div>
  );
}
