import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Badge } from "@/components/ui";
import { NativeSelect } from "@/components/assets/bits";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { specLines, STANDARDS_NOTE } from "@/lib/assets/room-standards";
import { checkedRooms, loadStandards } from "@/lib/assets/room-standards-server";
import { formatDate } from "@/lib/format";
import { humanize } from "@/lib/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Room type data sheet" };

const STATE = { ok: { tone: "ok", label: "Meets it" }, short: { tone: "danger", label: "Short" }, unknown: { tone: "warn", label: "Not surveyed" }, none: { tone: "neutral", label: "—" } } as const;

/** The room data sheet for one room type (wave 14): its standard, and the hospital's rooms that follow it. */
export default async function RoomTypeSheet({ params, searchParams }: { params: Promise<{ index: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { index } = await params;
  const sp = await searchParams;
  const { rules } = await loadStandards();
  const i = Number(index);
  const rule = Number.isInteger(i) ? rules[i] : undefined;
  if (!rule) notFound();
  const scope = await facilityScope(me);
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const wanted = Number(typeof sp.facilityId === "string" ? sp.facilityId : NaN);
  if (Number.isInteger(wanted) && wanted > 0) await requireFacilityAccess(wanted, me);
  const fac = facs.find((f) => f.id === wanted) ?? facs[facs.length - 1] ?? null;
  const mine = fac ? (await checkedRooms(fac.id, rules)).filter((r) => r.standardIndex === i) : [];
  const lines = specLines(rule.spec);
  const groups = [...new Set(lines.map((l) => l.group))];
  const short = mine.filter((r) => r.state === "short").length, unknown = mine.filter((r) => r.state === "unknown").length;

  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <Link href={`/facilities/room-standards${fac ? `?facilityId=${fac.id}` : ""}`} className="text-sm text-primary hover:underline">← Room standards</Link>
        {facs.length > 1 && (
          <form className="flex items-end gap-2">
            <NativeSelect name="facilityId" value={fac?.id} options={facs.map((f) => ({ value: f.id, label: f.name }))} aria-label="Hospital" />
            <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Show</button>
          </form>
        )}
        <PrintButton />
      </div>
      <article className="mx-auto max-w-4xl rounded border border-line bg-surface p-6 text-sm print:border-0 print:p-0">
        <header className="mb-4 border-b-2 border-ink pb-2">
          <h1 className="text-lg font-bold">Room data sheet: {rule.label}</h1>
          <p className="text-xs text-muted">Applies to {rule.match ? <>rooms named <code>{rule.match}</code></> : <>{humanize(rule.roomType ?? "").toLowerCase()} rooms without a more specific rule</>} · {formatDate(new Date())}</p>
        </header>
        {groups.length === 0 ? <p className="text-muted">This standard sets nothing yet.</p> : groups.map((g) => (
          <section key={g} className="mb-3 break-inside-avoid">
            <h2 className="mb-1 font-semibold">{g}</h2>
            <table className="w-full"><tbody>
              {lines.filter((l) => l.group === g).map((l) => <tr key={l.label} className="border-b border-line/60"><th className="w-56 py-1 pr-3 text-left align-top font-normal text-muted">{l.label}</th><td className="py-1">{l.value}</td></tr>)}
            </tbody></table>
          </section>
        ))}
        <p className="mt-2 text-xs text-muted">{rule.source ? <>Source: {rule.source}. </> : null}{STANDARDS_NOTE}</p>

        <h2 className="mt-6 mb-1 font-semibold">{fac ? `Rooms in ${fac.name} that follow it (${mine.length})` : "Rooms"}</h2>
        {fac && mine.length > 0 && <p className="mb-2 text-xs text-muted">{short ? <b className="text-danger">{short} short of the standard. </b> : null}{unknown ? `${unknown} not fully surveyed (record ceiling, door, load and services in the 3D room details). ` : ""}Areas from the drawings{rule.spec.minAreaM2 != null ? ", per bed space when the room has beds" : ""}.</p>}
        {!mine.length ? <p className="text-muted">No room follows this standard{fac ? ` in ${fac.name}` : ""}.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-ink text-left"><th className="py-1">Room</th><th>Floor</th><th>Department</th><th className="text-right">Area</th><th>Check</th><th>Short of</th></tr></thead>
              <tbody>{mine.map((r) => (
                <tr key={r.id} className="border-b border-line/60 align-top">
                  <td className="py-1"><Link href={`/facilities/${fac!.id}/rooms/${r.id}/sheet`} className="text-primary hover:underline">{r.name}</Link> <span className="font-mono text-muted">{r.code}</span></td>
                  <td>{r.floor}</td><td>{r.department ?? "—"}</td>
                  <td className="text-right">{r.areaM2.toFixed(1)} m²{r.beds > 1 ? <span className="block text-muted">{r.beds} beds</span> : null}</td>
                  <td><Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge></td>
                  <td>{r.rows.filter((x) => x.state === "short").map((x) => `${x.label}: ${x.have} (${x.need})`).join("; ") || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </article>
    </>
  );
}
