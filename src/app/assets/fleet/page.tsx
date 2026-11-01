import Link from "next/link";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceModels, deviceTypes, preferredModels } from "@/db/schema";
import { Badge, Button, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { setPreferredModelAction } from "@/app/catalogue/actions";
import { fleetSummary, nameKey, SUPPORT_LABELS, SUPPORT_TONE } from "@/lib/assets/models";
import { listFacilities } from "@/lib/assets/queries";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatNumber, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fleet and standardisation" };

export default async function FleetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await listFacilities(scope);
  if (!facs.length) return <><PageHeader title="Fleet and standardisation" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const wanted = Number(sp.facilityId);
  const fac = facs.find((f) => f.id === wanted) ?? facs[0];
  await requireFacilityAccess(fac.id, me);
  const show = sp.show === "all" ? "all" : sp.show === "support" ? "support" : "mixed";

  const rows = await db.select({ deviceTypeId: assets.deviceTypeId, manufacturer: assets.manufacturer, model: assets.model })
    .from(assets).where(and(eq(assets.facilityId, fac.id), sql`${assets.status} <> 'DISPOSED'`));
  const typeIds = [...new Set(rows.map((r) => r.deviceTypeId))];
  const [types, models, prefs] = typeIds.length ? await Promise.all([
    db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes).where(inArray(deviceTypes.id, typeIds)),
    db.select().from(deviceModels).where(inArray(deviceModels.deviceTypeId, typeIds)).orderBy(asc(deviceModels.manufacturer), asc(deviceModels.model)),
    db.select().from(preferredModels).where(eq(preferredModels.facilityId, fac.id)),
  ]) : [[], [], []];
  const fleet = fleetSummary(rows, models, new Map(prefs.map((p) => [p.deviceTypeId, p.modelId])), todayISO());
  const typeById = new Map(types.map((t) => [t.id, t]));
  const shown = fleet.filter((f) => show === "all" ? true : show === "support" ? f.unsupported > 0 || f.models.some((m) => m.support === "ending") : f.makers.length > 1 || f.models.length > 1);
  const canSet = can(me.role, "catalogue.edit");
  const mixed = fleet.filter((f) => f.makers.length > 1).length;
  const unsupported = fleet.reduce((t, f) => t + f.unsupported, 0);
  const unknown = fleet.reduce((t, f) => t + f.unknown, 0);
  const withPref = fleet.filter((f) => f.preferredId).length;
  const href = (o: Record<string, string>) => `/assets/fleet?${new URLSearchParams({ facilityId: String(fac.id), show, ...o })}`;

  return (
    <>
      <PageHeader title="Fleet and standardisation"
        description="How many makes and models of each device type the hospital runs. Fewer models means easier training, spares and service."
        actions={<LinkButton href="/catalogue/models">Makes and models</LinkButton>} />
      <Notice sp={sp} />
      {facs.length > 1 && (
        <form action="/assets/fleet" className="mb-4 flex flex-wrap items-center gap-2">
          <NativeSelect name="facilityId" aria-label="Hospital" options={facs.map((f) => ({ value: f.id, label: f.name }))} value={fac.id} />
          <input type="hidden" name="show" value={show} />
          <Button variant="secondary">Show</Button>
        </form>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Device types with more than one make" value={formatNumber(mixed)} hint={`of ${fleet.length} in use`} href={href({ show: "mixed" })} />
        <Stat label="Units out of maker support" value={formatNumber(unsupported)} hint="No more parts or service" href={href({ show: "support" })} />
        <Stat label="Units with no make or model" value={formatNumber(unknown)} hint="Fill them in on each asset" href={`/assets?facilityId=${fac.id}`} />
        <Stat label="Types with a preferred model" value={formatNumber(withPref)} />
      </div>
      <nav className="mb-3 flex flex-wrap gap-1" aria-label="Show">
        {([["mixed", "More than one make or model"], ["support", "Support ending or ended"], ["all", "All device types"]] as const).map(([k, label]) => (
          <Link key={k} href={href({ show: k })} className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold ${show === k ? "bg-primary-soft text-primary-strong" : "text-muted hover:text-ink"}`}>{label}</Link>
        ))}
      </nav>
      {shown.length === 0 ? <EmptyState title="Nothing to show">{show === "mixed" ? "Every device type in this hospital is a single make and model." : "No device type here."}</EmptyState> : (
        <ul className="space-y-3">
          {shown.map((f) => {
            const t = typeById.get(f.deviceTypeId)!;
            const choices = models.filter((m) => m.deviceTypeId === f.deviceTypeId && (m.active || m.id === f.preferredId));
            return (
              <li key={f.deviceTypeId} id={`type-${f.deviceTypeId}`} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/catalogue/${t.code}`} className="text-[15px] font-semibold text-primary hover:underline">{t.name}</Link>
                  <span className="text-sm text-muted">{f.units} units · {f.makers.length} make{f.makers.length === 1 ? "" : "s"} · {f.models.length} model{f.models.length === 1 ? "" : "s"} · {f.standardisation} % on the most common model</span>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {f.models.map((m) => (
                    <li key={nameKey(`${m.manufacturer} ${m.model}`)} className="flex flex-wrap items-center gap-2">
                      <span className="h-2 shrink-0 rounded-sm bg-primary" style={{ width: `${Math.max(4, (m.units / f.units) * 160)}px` }} aria-hidden />
                      <span>{m.manufacturer} {m.model}</span><span className="text-muted">{m.units}</span>
                      {m.preferred && <Badge tone="ok">Preferred</Badge>}
                      {m.support && m.support !== "supported" && <Badge tone={SUPPORT_TONE[m.support]}>{SUPPORT_LABELS[m.support]}</Badge>}
                      {m.support == null && <span className="text-xs text-muted">(not in the catalogue)</span>}
                    </li>
                  ))}
                  {f.unknown > 0 && <li className="text-muted">{f.unknown} unit{f.unknown === 1 ? "" : "s"} with no make or model recorded</li>}
                </ul>
                {canSet && (
                  <form action={setPreferredModelAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
                    <input type="hidden" name="facilityId" value={fac.id} /><input type="hidden" name="deviceTypeId" value={f.deviceTypeId} />
                    <label htmlFor={`pref-${f.deviceTypeId}`} className="text-muted">Preferred model</label>
                    <select id={`pref-${f.deviceTypeId}`} name="modelId" defaultValue={f.preferredId ?? ""} className="min-w-0 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1">
                      <option value="">None</option>
                      {choices.map((m) => <option key={m.id} value={m.id}>{m.manufacturer} {m.model}</option>)}
                    </select>
                    <input name="reason" maxLength={500} placeholder="Why (optional)" aria-label="Reason" className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 sm:max-w-xs" />
                    <Button variant="secondary">Save preferred model</Button>
                    {!choices.length && <Link href={`/catalogue/models/new?deviceTypeId=${f.deviceTypeId}`} className="text-primary hover:underline">Add its models to the catalogue first</Link>}
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
