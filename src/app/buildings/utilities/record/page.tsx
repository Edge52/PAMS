import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, utilitySystems } from "@/db/schema";
import { Button, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Crumbs } from "@/components/assets/bits";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import {
  CHECKS_LABEL, defaultsFor, GEN_LOAD_MIN_MINUTES, GEN_LOAD_MIN_SHARE, isTestKind, isUtilityKind, KIND_INFO, KIND_LABELS, TEST_FIELDS, TEST_LABELS, TRANSFER_MAX_SECONDS, type TestKind,
} from "@/lib/utilities/utilities";
import { recordUtilityTestAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record a utility test" };

const FIELD: Record<string, { label: string; unit: string; min?: number; max?: number }> = {
  loadKw: { label: "Load", unit: "kW", min: 0 }, durationMin: { label: "Run time", unit: "minutes", min: 0 }, transferSec: { label: "Transfer time", unit: "seconds", min: 0 },
  fuelPct: { label: "Fuel level", unit: "%", min: 0, max: 100 }, autonomyMin: { label: "Autonomy", unit: "minutes", min: 0 },
  tempMin: { label: "Lowest temperature", unit: "°C" }, tempMax: { label: "Highest temperature", unit: "°C" }, excursionMin: { label: "Minutes out of range", unit: "minutes", min: 0 },
  airChanges: { label: "Air changes", unit: "per hour", min: 0 }, pressurePa: { label: "Pressure difference", unit: "Pa (minus for negative)" },
};

/** Record one test of a utility system; the result is worked out from the readings. */
export default async function RecordUtilityTestPage({ searchParams }: { searchParams: Promise<{ systemId?: string; kind?: string }> }) {
  const me = await requirePermission("maintenance.edit");
  const sp = await searchParams;
  const id = Number(sp.systemId);
  const [row] = Number.isInteger(id) && id > 0 ? await db.select({ s: utilitySystems, tag: assets.assetTag, typeCode: deviceTypes.code, typeName: deviceTypes.name }).from(utilitySystems)
    .innerJoin(assets, eq(assets.id, utilitySystems.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(utilitySystems.id, id)) : [];
  if (!row) return <><PageHeader title="Record a utility test" /><EmptyState title="Choose a system">Open the Due list on <Link className="text-primary hover:underline" href="/buildings/utilities">Utilities</Link> and press Record.</EmptyState></>;
  await requireFacilityAccess(row.s.facilityId, me);
  const kind = isUtilityKind(row.s.kind) ? row.s.kind : "OTHER";
  const tests = KIND_INFO[kind].tests.map((t) => t.kind);
  const test: TestKind = isTestKind(sp.kind) && tests.includes(sp.kind) ? sp.kind : tests[0];
  const d = defaultsFor(kind, row.typeCode);
  const fields = TEST_FIELDS[test];
  const rule = ruleText(test, row.s, d);
  const back = `/buildings/utilities?facilityId=${row.s.facilityId}`;

  return (
    <>
      <Crumbs items={[{ label: "Utilities", href: back }, { label: row.tag }]} />
      <PageHeader title={TEST_LABELS[test]} description={`${row.tag} · ${KIND_LABELS[kind]} · ${row.typeName}${row.s.serves ? ` · serves ${row.s.serves}` : ""}`} />
      {tests.length > 1 && (
        <p className="mb-4 flex flex-wrap gap-3 text-sm">{tests.map((t) => t === test ? <strong key={t}>{TEST_LABELS[t]}</strong> : <Link key={t} className="text-primary hover:underline" href={`/buildings/utilities/record?systemId=${row.s.id}&kind=${t}`}>{TEST_LABELS[t]}</Link>)}</p>
      )}
      <Panel>
        <ActionForm action={recordUtilityTestAction} className="space-y-4">
          <input type="hidden" name="systemId" value={row.s.id} /><input type="hidden" name="kind" value={test} />
          {rule && <p className="text-sm text-muted">{rule}</p>}
          <FormGrid cols={3}>
            <Field label="Date"><Input name="testedOn" type="date" defaultValue={todayISO()} max={todayISO()} required /></Field>
            {fields.filter((f) => f !== "checksOk").map((f) => (
              <Field key={f} label={`${FIELD[f].label} (${FIELD[f].unit})`}><Input name={f} type="number" step="any" inputMode="decimal" min={FIELD[f].min} max={FIELD[f].max} required={f !== "excursionMin" && !(f === "pressurePa" && (row.s.pressure ?? d.pressure ?? "NONE") === "NONE")} /></Field>
            ))}
          </FormGrid>
          {fields.includes("checksOk") && (
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium">{CHECKS_LABEL[test]}</legend>
              <label className="mr-4 inline-flex items-center gap-2"><input type="radio" name="checksOk" value="yes" required /> Yes</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="checksOk" value="no" /> No, problem found</label>
            </fieldset>
          )}
          <Field label="Notes"><Textarea name="notes" maxLength={2000} placeholder="What was done, who was there, anything odd" /></Field>
          <p className="text-xs text-muted">A failed test opens a work order on this system and tells the biomedical team.</p>
          <Button>Save result</Button>
        </ActionForm>
      </Panel>
    </>
  );
}

function ruleText(test: TestKind, s: typeof utilitySystems.$inferSelect, d: ReturnType<typeof defaultsFor>): string | null {
  switch (test) {
    case "GEN_LOAD": return `Pass: at least ${GEN_LOAD_MIN_MINUTES} minutes${s.ratedKw ? `, at least ${Math.round(s.ratedKw * GEN_LOAD_MIN_SHARE)} kW (${GEN_LOAD_MIN_SHARE * 100} % of ${s.ratedKw} kW)` : ""}, transfer in ${TRANSFER_MAX_SECONDS} s or less (NFPA 110 figures; check your local code).`;
    case "TRANSFER": return `Pass: transfer in ${TRANSFER_MAX_SECONDS} s or less.`;
    case "FUEL": return `Pass: at least ${s.minFuelPct ?? d.minFuelPct ?? 50} %.`;
    case "UPS_AUTONOMY": return `Pass: holds the load for at least ${s.requiredMinutes ?? d.requiredMinutes ?? 10} minutes.`;
    case "COLD_CHAIN": return `Pass: stayed within ${s.tempLow ?? d.tempLow ?? 2}–${s.tempHigh ?? d.tempHigh ?? 8} °C. Enter the lowest and highest from the log or data logger.`;
    case "HVAC_CHECK": {
      const p = s.pressure ?? d.pressure ?? "NONE", pa = s.minPressurePa ?? d.minPressurePa ?? 2.5;
      return `Pass: at least ${s.requiredAch ?? d.requiredAch ?? "the design"} air changes an hour${p === "POSITIVE" ? `, at least +${pa} Pa` : p === "NEGATIVE" ? `, at most −${pa} Pa` : ""}.`;
    }
    case "TANK_CLEAN": return "Record the water sample result on Water quality.";
    default: return null;
  }
}
