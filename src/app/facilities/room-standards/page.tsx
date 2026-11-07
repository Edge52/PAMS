import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities, roomType } from "@/db/schema";
import { Badge, Button, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Crumbs, NativeSelect, Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { equipmentText, GAS_LABELS, GASES, STANDARDS_NOTE, type RoomStandardSpec } from "@/lib/assets/room-standards";
import { checkedRooms, loadStandards } from "@/lib/assets/room-standards-server";
import { humanize } from "@/lib/status";
import { deleteStandardAction, moveStandardAction, resetStandardsAction, saveStandardAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Room standards" };

const gasText = (s: RoomStandardSpec) => Object.entries(s.gases ?? {}).map(([g, n]) => `${g} ${n}`).join(" · ") || "—";
const airText = (s: RoomStandardSpec) => [s.airChanges != null && `${s.airChanges} ach`, s.pressure && s.pressure !== "neutral" && s.pressure].filter(Boolean).join(", ") || "—";
const yn = (v: boolean | undefined) => (v == null ? "" : v ? "yes" : "no");

/** Room data sheets per room type (wave 14): the standard for each kind of room, and how many rooms meet it. */
export default async function RoomStandardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const { rules, custom } = await loadStandards();
  const mayEdit = can(me.role, "facilities.edit");
  const scope = await facilityScope(me);
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const wanted = Number(typeof sp.facilityId === "string" ? sp.facilityId : NaN);
  const fac = facs.find((f) => f.id === wanted) ?? facs[facs.length - 1] ?? null;
  const checked = fac ? await checkedRooms(fac.id, rules) : [];
  const count = (i: number) => { const rs = checked.filter((r) => r.standardIndex === i); return { n: rs.length, short: rs.filter((r) => r.state === "short").length }; };
  const unmatched = checked.filter((r) => r.standardIndex == null && r.type !== "CORRIDOR").length;
  const editIdx = typeof sp.edit === "string" ? Number(sp.edit) : NaN;
  const editing = Number.isInteger(editIdx) && editIdx >= 0 ? rules[editIdx] : undefined;
  const adding = sp.edit === "new";
  const idField = (i: number) => (rules[i].id ? <input type="hidden" name="ruleId" value={rules[i].id} /> : <input type="hidden" name="ruleIndex" value={i} />);
  const s = editing?.spec ?? {};
  const q = fac ? `?facilityId=${fac.id}` : "";

  return (
    <>
      <Crumbs items={[{ label: "Facilities & floors", href: "/facilities" }, { label: "Room standards" }]} />
      <PageHeader title="Room standards" description="Standard finishes and services for each kind of room: the room data sheet per room type. Name rules are tried in order (first match wins), then room types. Each room's own sheet compares its survey with its standard." />
      <Notice sp={sp} />
      <p className="mb-3 text-sm text-muted">{custom ? "Edited for this installation." : "The built-in set (seed-data/room-standards.json). Your first change makes an editable copy."} {STANDARDS_NOTE}</p>
      {facs.length > 1 && (
        <form className="mb-4 flex items-end gap-2">
          <Field label="Count rooms in"><NativeSelect name="facilityId" value={fac?.id} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      {!rules.length ? <EmptyState title="No room standards">Add one below, or reset to the built-in set.</EmptyState> : (
        <Table>
          <THead><tr><Th>Standard</Th><Th>Applies to</Th><Th align="right">Area</Th><Th>Equipment</Th><Th>Gases</Th><Th>Air</Th><Th align="right">{fac ? `Rooms in ${fac.name}` : "Rooms"}</Th>{mayEdit && <Th />}</tr></THead>
          <tbody>
            {rules.map((r, i) => { const c = count(i); return (
              <tr key={r.id ?? `b${i}`} className={editIdx === i ? "bg-primary-soft/40" : undefined}>
                <Td><Link href={`/facilities/room-standards/${i}${q}`} className="font-semibold text-primary hover:underline">{r.label}</Link></Td>
                <Td>{r.match ? <code className="break-all text-xs">{r.match}</code> : <Badge>{humanize(r.roomType ?? "")}</Badge>}</Td>
                <Td align="right">{r.spec.minAreaM2 != null ? `${r.spec.minAreaM2} m²` : "—"}</Td>
                <Td><span className="text-xs">{r.spec.equipment?.length ? r.spec.equipment.map((e) => e.label).join(", ") : "—"}</span></Td>
                <Td><span className="text-xs">{gasText(r.spec)}</span></Td>
                <Td><span className="text-xs">{airText(r.spec)}</span></Td>
                <Td align="right">{c.n ? <>{c.n}{c.short > 0 && <span className="block text-xs font-semibold text-danger">{c.short} short</span>}</> : <span className="text-muted">—</span>}</Td>
                {mayEdit && (
                  <Td><div className="flex items-center gap-2 text-sm">
                    <Link href={`?${new URLSearchParams({ ...(fac ? { facilityId: String(fac.id) } : {}), edit: String(i) })}#rule-form`} className="text-primary hover:underline">Edit</Link>
                    <form action={moveStandardAction}>{idField(i)}<input type="hidden" name="dir" value="up" /><button disabled={i === 0} className="px-1 disabled:opacity-30" aria-label={`Move ${r.label} up`}>↑</button></form>
                    <form action={moveStandardAction}>{idField(i)}<input type="hidden" name="dir" value="down" /><button disabled={i === rules.length - 1} className="px-1 disabled:opacity-30" aria-label={`Move ${r.label} down`}>↓</button></form>
                    <form action={deleteStandardAction}>{idField(i)}<button className="text-danger hover:underline">Remove</button></form>
                  </div></Td>
                )}
              </tr>
            ); })}
          </tbody>
        </Table>
      )}
      {fac && unmatched > 0 && <p className="mt-2 text-xs text-muted">{unmatched} room{unmatched === 1 ? "" : "s"} in {fac.name} (not counting corridors) follow no standard: add a rule for their name or room type.</p>}
      {mayEdit && (
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`?${new URLSearchParams({ ...(fac ? { facilityId: String(fac.id) } : {}), edit: "new" })}#rule-form`} className="text-sm font-semibold text-primary hover:underline">Add a standard</Link>
          {custom && <form action={resetStandardsAction}><button className="text-sm text-muted hover:text-danger">Reset to the built-in standards</button></form>}
        </div>
      )}
      {mayEdit && (editing || adding) && (
        <Panel title={editing ? `Edit “${editing.label}”` : "Add a standard"} className="mt-5">
          <div id="rule-form" />
          <ActionForm action={saveStandardAction} key={editing ? `e${editIdx}` : "new"}>
            {editing && idField(editIdx)}
            <FormGrid cols={3}>
              <Field label="Name"><Input name="label" required maxLength={120} defaultValue={editing?.label} placeholder="e.g. Operating theatre" /></Field>
              <Field label="Room names matching" hint="Words or patterns separated by |, any case: THEATRE|OPERATING"><Input name="match" maxLength={300} defaultValue={editing?.match ?? ""} /></Field>
              <Field label="Or room type" hint="Used only without a name pattern">
                <NativeSelect name="roomType" value={editing?.roomType ?? ""} placeholder="—" options={roomType.enumValues.map((t) => ({ value: t, label: humanize(t) }))} />
              </Field>
            </FormGrid>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Room</h3>
            <FormGrid cols={3}>
              <Field label="Clear width, m" hint="Narrowest side of the room"><Input name="minWidthM" inputMode="decimal" defaultValue={s.minWidthM ?? ""} /></Field>
              <Field label="Clear floor area, m²" hint="Per bed space when the room has beds"><Input name="minAreaM2" inputMode="decimal" defaultValue={s.minAreaM2 ?? ""} /></Field>
              <Field label="Clear ceiling, m"><Input name="minCeilingM" inputMode="decimal" defaultValue={s.minCeilingM ?? ""} /></Field>
              <Field label="Door clear width, m"><Input name="minDoorWidthM" inputMode="decimal" defaultValue={s.minDoorWidthM ?? ""} /></Field>
              <Field label="Floor load, kg/m²"><Input name="minFloorLoadKgM2" inputMode="numeric" defaultValue={s.minFloorLoadKgM2 ?? ""} /></Field>
            </FormGrid>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Equipment</h3>
            <Field label="One item a line: catalogue code, how many, clearance around it in metres, name"
              hint="e.g. MON-PAT, 1 a bed, 0.6, Patient monitor. A code counts every device under it (MON-PAT counts MON-PAT-HIGH). Leave the clearance empty if none.">
              <Textarea name="equipment" rows={4} maxLength={4000} defaultValue={equipmentText(s.equipment)} className="font-mono text-xs" />
            </Field>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Finishes</h3>
            <FormGrid cols={3}>
              <Field label="Floor"><Input name="floorFinish" maxLength={160} defaultValue={s.floorFinish ?? ""} /></Field>
              <Field label="Walls"><Input name="wallFinish" maxLength={160} defaultValue={s.wallFinish ?? ""} /></Field>
              <Field label="Ceiling"><Input name="ceilingFinish" maxLength={160} defaultValue={s.ceilingFinish ?? ""} /></Field>
            </FormGrid>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Medical gas outlets (per bed space or room)</h3>
            <FormGrid cols={3}>
              {GASES.map((g) => <Field key={g} label={GAS_LABELS[g]}><Input name={`gas_${g}`} inputMode="numeric" defaultValue={s.gases?.[g] ?? ""} /></Field>)}
            </FormGrid>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Power, data and light</h3>
            <FormGrid cols={4}>
              <Field label="Sockets"><Input name="sockets" inputMode="numeric" defaultValue={s.sockets ?? ""} /></Field>
              <Field label="Of which essential supply"><Input name="essentialSockets" inputMode="numeric" defaultValue={s.essentialSockets ?? ""} /></Field>
              <Field label="Equipment power, kVA"><Input name="powerKva" inputMode="decimal" defaultValue={s.powerKva ?? ""} /></Field>
              <Field label="Data points"><Input name="dataPoints" inputMode="numeric" defaultValue={s.dataPoints ?? ""} /></Field>
              <Field label="General lighting, lux"><Input name="lightingLux" inputMode="numeric" defaultValue={s.lightingLux ?? ""} /></Field>
            </FormGrid>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Air</h3>
            <FormGrid cols={4}>
              <Field label="Air changes an hour"><Input name="airChanges" inputMode="decimal" defaultValue={s.airChanges ?? ""} /></Field>
              <Field label="Pressure"><NativeSelect name="pressure" value={s.pressure ?? ""} placeholder="—" options={[{ value: "positive", label: "Positive" }, { value: "negative", label: "Negative" }, { value: "neutral", label: "Neutral" }]} /></Field>
              <Field label="Temperature, °C" hint="e.g. 18–25"><Input name="temperatureC" maxLength={20} defaultValue={s.temperatureC ?? ""} /></Field>
              <Field label="Humidity, %" hint="e.g. 40–60"><Input name="humidityPct" maxLength={20} defaultValue={s.humidityPct ?? ""} /></Field>
            </FormGrid>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Fittings and special services</h3>
            <FormGrid cols={3}>
              {([["nurseCall", "Nurse call"], ["handWash", "Clinical hand wash basin"], ["rfShield", "RF shielding"], ["leadLined", "Lead lining"], ["chilledWater", "Chilled water"], ["quenchPipe", "Quench pipe"]] as const).map(([k, label]) => (
                <Field key={k} label={label}><NativeSelect name={k} value={yn(s[k])} placeholder="Not set" options={[{ value: "yes", label: "Needed" }, { value: "no", label: "Not needed" }]} /></Field>
              ))}
            </FormGrid>
            <Field label="Notes" className="mt-3"><Textarea name="notes" rows={2} maxLength={1000} defaultValue={s.notes ?? ""} /></Field>
            <Field label="Source" className="mt-3" hint="Where the figures come from, e.g. HBN 26; HTM 03-01"><Input name="source" maxLength={500} defaultValue={editing?.source ?? ""} /></Field>
            <div className="mt-3 flex gap-2"><Button>Save standard</Button><Link href={`?${fac ? `facilityId=${fac.id}` : ""}`} className="self-center text-sm text-muted">Cancel</Link></div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
