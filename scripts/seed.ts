/**
 * Seed runner.  npm run db:seed            → load reference data + module demo data (idempotent for reference data)
 *               npm run db:seed -- --reset → wipe ALL tables first
 *               npm run db:reset -- --only=facility,boq → reset, reference data, then only the listed module seeds
 *               npm run db:seed -- --refresh-reference → overwrite existing reference rows from seed-data/ (never on start-up)
 *
 * Order: reference → users (demo accounts) → facility → boq → procurement → assets → cad → lifts → approvals → workorders → plan → models → site → planning → money → commissioning → safety → security → maintenance → finance → north → radiation.
 * Each module seed lives in scripts/seed/<name>.ts and exports `default async function seed(db: DB): Promise<void>`.
 * Missing module files are skipped, so the runner works while modules are still being built.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, db, type DB } from "../src/db";
import { boqRules, departmentTypes, deviceCompanions, deviceTypes, exchangeRates, standardSets } from "../src/db/schema";

const root = path.resolve(__dirname, "..");
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(root, rel), "utf8")) as T;

type TaxonomyRow = {
  code: string; parentCode: string | null; level: number; name: string; nameAr?: string; description?: string;
  umdnsCode?: string; gmdnTerm?: string; riskClass?: "I" | "IIa" | "IIb" | "III";
  criticality?: "LIFE_SUPPORT" | "HIGH" | "MEDIUM" | "LOW"; lifeExpectancyYears?: number; ppmIntervalMonths?: number;
  requiresCalibration?: boolean; isCapital?: boolean; priceMinUsd?: number; priceMaxUsd?: number;
  specTemplate?: { name: string; unit?: string; hint?: string }[];
};
type StandardsFile = {
  standardSets: { code: string; name: string; description?: string; version?: string; isDefault?: boolean;
    sources?: { id: string; title: string; url?: string; publisher?: string; year?: number }[] }[];
  rules: { standardSetCode: string; departmentTypeCode: string; deviceTypeCode: string;
    basis: "PER_BED" | "PER_ROOM" | "PER_DEPARTMENT" | "PER_HOSPITAL_BEDS" | "FIXED"; ratio: number;
    minQty?: number; maxQty?: number | null; rounding?: "CEIL" | "ROUND" | "FLOOR"; tier?: "ESSENTIAL" | "RECOMMENDED" | "OPTIONAL";
    confidence?: "SOURCED" | "INDUSTRY_PRACTICE" | "DRAFT"; sourceRef?: string; notes?: string }[];
};

/**
 * Reference data. By default this is insert-only (CO-01): rows that already exist are left exactly as they are, so the
 * start-up seed never undoes an administrator's edits to device types, department types, BOQ rules, companions or the
 * default standard set. `refresh: true` (npm run db:seed -- --refresh-reference) overwrites them from seed-data/ on purpose.
 */
export async function seedReference(d: DB, opts: { refresh?: boolean } = {}) {
  const refresh = opts.refresh ?? false;
  // Department types
  const deps = readJson<{ code: string; name: string; nameAr?: string; category?: string; description?: string; sortOrder?: number }[]>("seed-data/department-types.json");
  for (const r of deps) {
    const ins = d.insert(departmentTypes).values(r);
    await (refresh ? ins.onConflictDoUpdate({ target: departmentTypes.code,
      set: { name: r.name, nameAr: r.nameAr, category: r.category, description: r.description, sortOrder: r.sortOrder ?? 0 } }) : ins.onConflictDoNothing());
  }

  // Device taxonomy (parents before children)
  const tax = readJson<TaxonomyRow[]>("seed-data/device-taxonomy.json").sort((a, b) => a.level - b.level);
  const idByCode = new Map<string, number>();
  for (const r of await d.select({ id: deviceTypes.id, code: deviceTypes.code }).from(deviceTypes)) idByCode.set(r.code, r.id);
  for (const r of tax) {
    const parentId = r.parentCode ? idByCode.get(r.parentCode) ?? null : null;
    if (r.parentCode && parentId === null) throw new Error(`Taxonomy: parent ${r.parentCode} missing for ${r.code}`);
    const values = {
      code: r.code, parentId, level: r.level, name: r.name, nameAr: r.nameAr ?? null, description: r.description ?? null,
      umdnsCode: r.umdnsCode ?? null, gmdnTerm: r.gmdnTerm ?? null, riskClass: r.riskClass ?? null, criticality: r.criticality ?? null,
      lifeExpectancyYears: r.lifeExpectancyYears ?? null, ppmIntervalMonths: r.ppmIntervalMonths ?? null,
      requiresCalibration: r.requiresCalibration ?? false, isCapital: r.isCapital ?? r.level === 3,
      priceMinUsd: r.priceMinUsd != null ? String(r.priceMinUsd) : null, priceMaxUsd: r.priceMaxUsd != null ? String(r.priceMaxUsd) : null,
      specTemplate: r.specTemplate ?? null,
    };
    if (!refresh && idByCode.has(r.code)) continue; // existing device type: keep the administrator's life, PPM, risk class
    const [row] = await d.insert(deviceTypes).values(values)
      .onConflictDoUpdate({ target: deviceTypes.code, set: values }).returning({ id: deviceTypes.id });
    idByCode.set(r.code, row.id);
  }

  // BOQ standards
  const std = readJson<StandardsFile>("seed-data/boq-standards.json");
  const setId = new Map<string, number>();
  const existingSets = await d.select({ id: standardSets.id, code: standardSets.code, isDefault: standardSets.isDefault }).from(standardSets);
  const newSetIds = new Set<number>();
  let hasDefault = existingSets.some((x) => x.isDefault);
  for (const x of existingSets) setId.set(x.code, x.id);
  for (const s of std.standardSets) {
    if (!refresh && setId.has(s.code)) continue; // existing set: keep its name, sources and the administrator's default choice
    // A newly added set never takes the default away from the one the administrator chose.
    const isDefault = refresh ? s.isDefault ?? false : (s.isDefault ?? false) && !hasDefault;
    if (isDefault) hasDefault = true;
    const v = { code: s.code, name: s.name, description: s.description ?? null, version: s.version ?? "1.0", isDefault, sources: s.sources ?? [] };
    const [row] = await d.insert(standardSets).values(v).onConflictDoUpdate({ target: standardSets.code, set: v }).returning({ id: standardSets.id });
    setId.set(s.code, row.id); newSetIds.add(row.id);
  }
  /** Rules: upsert on refresh; otherwise add only rules that don't exist yet, so edited ratios and tiers survive. */
  const newRuleIds = new Set<number>();
  const upsertRule = async (v: typeof boqRules.$inferInsert) => {
    const ins = d.insert(boqRules).values(v);
    const rows = await (refresh ? ins.onConflictDoUpdate({ target: [boqRules.standardSetId, boqRules.departmentTypeCode, boqRules.deviceTypeId, boqRules.condition], set: v })
      : ins.onConflictDoNothing({ target: [boqRules.standardSetId, boqRules.departmentTypeCode, boqRules.deviceTypeId, boqRules.condition] })).returning({ id: boqRules.id });
    for (const r of rows) newRuleIds.add(r.id);
  };
  let skipped = 0;
  for (const r of std.rules) {
    const sId = setId.get(r.standardSetCode); const dId = idByCode.get(r.deviceTypeCode);
    if (!sId || !dId) { skipped++; console.warn(`  rule skipped: ${r.standardSetCode}/${r.departmentTypeCode}/${r.deviceTypeCode}`); continue; }
    const v = { standardSetId: sId, departmentTypeCode: r.departmentTypeCode, deviceTypeId: dId, basis: r.basis, ratio: r.ratio,
      minQty: r.minQty ?? 0, maxQty: r.maxQty ?? null, rounding: r.rounding ?? "CEIL", tier: r.tier ?? "ESSENTIAL",
      confidence: r.confidence ?? "DRAFT", sourceRef: r.sourceRef ?? null, notes: r.notes ?? null } as const;
    await upsertRule(v);
  }

  // BOQ quick start (wave 3): throughput rates, conditional rules and companion items.
  const qsFile = path.join(root, "seed-data", "boq-quickstart.json");
  if (existsSync(qsFile)) {
    type Q = {
      throughput: { dept: string; device: string; param: string; per: number; note?: string }[];
      conditional: { dept: string; device: string; condition: string; basis: StandardsFile["rules"][number]["basis"]; ratio: number; tier?: "ESSENTIAL" | "RECOMMENDED" | "OPTIONAL"; note?: string }[];
      companions: { device: string; companion: string; ratio: number; note?: string }[];
    };
    const q = readJson<Q>("seed-data/boq-quickstart.json");
    let tp = 0, cond = 0, comp = 0;
    for (const sId of setId.values()) {
      for (const t of q.throughput) {
        const dId = idByCode.get(t.device); if (!dId) continue;
        // Throughput rates go only on rules this run created (or on an explicit refresh), never on rules an administrator owns.
        if (!refresh && !newSetIds.has(sId) && newRuleIds.size === 0) continue;
        const res = await d.update(boqRules).set({ param: t.param, paramRatio: 1 / t.per })
          .where(and(eq(boqRules.standardSetId, sId), eq(boqRules.departmentTypeCode, t.dept), eq(boqRules.deviceTypeId, dId), eq(boqRules.condition, ""),
            refresh || newSetIds.has(sId) ? undefined : inArray(boqRules.id, [...newRuleIds])))
          .returning({ id: boqRules.id });
        tp += res.length;
      }
      for (const c of q.conditional) {
        const dId = idByCode.get(c.device); if (!dId) continue;
        const v = { standardSetId: sId, departmentTypeCode: c.dept, deviceTypeId: dId, basis: c.basis, ratio: c.ratio, minQty: 0, maxQty: null,
          rounding: "CEIL" as const, tier: c.tier ?? "ESSENTIAL", confidence: "DRAFT" as const, notes: c.note ?? null, condition: c.condition };
        await upsertRule(v);
        cond++;
      }
    }
    for (const c of q.companions) {
      const a = idByCode.get(c.device), b = idByCode.get(c.companion); if (!a || !b) continue;
      const ins = d.insert(deviceCompanions).values({ deviceTypeId: a, companionTypeId: b, ratio: c.ratio, note: c.note ?? null });
      await (refresh ? ins.onConflictDoUpdate({ target: [deviceCompanions.deviceTypeId, deviceCompanions.companionTypeId], set: { ratio: c.ratio, note: c.note ?? null } })
        : ins.onConflictDoNothing());
      comp++;
    }
    console.log(`quick start: ${tp} throughput rates, ${cond} conditional rules, ${comp} companion pairs`);
  }

  // Exchange rates: indicative starting rates only (insert-only). Finance keeps them current under Finance › Exchange rates.
  for (const [currency, rate] of [["USD", "48.500000"], ["EUR", "52.800000"], ["GBP", "61.900000"], ["CNY", "6.750000"]] as const) {
    await d.insert(exchangeRates).values({ currency, rateToEgp: rate, effectiveDate: "2026-10-01" }).onConflictDoNothing();
  }
  console.log(`reference: ${deps.length} department types, ${tax.length} device types, ${std.standardSets.length} standard sets, ${std.rules.length - skipped} rules`);
  // Drawing sources for hospitals loaded before wave 16 (a no-op once every room has one).
  const { backfillCadSources } = await import("../src/lib/assets/cad-sources");
  const n = await backfillCadSources(d, path.join(root, "seed-data", "cad"));
  if (n) console.log(`drawing sources: ${n} rooms recorded`);
  // Equipment 3D library (wave 17): the first set of imaging models in the catalogue, with typical site data.
  const { ensureLibraryModels } = await import("../src/lib/assets/equipment-library-seed");
  const lib = await ensureLibraryModels(d);
  if (lib.models || lib.site) console.log(`equipment library: ${lib.models} models, ${lib.site} with typical site data`);
}

async function resetAll(d: DB) {
  const rows = await d.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`);
  const names = rows.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await d.execute(sql.raw(`truncate ${names} restart identity cascade`));
  await d.execute(sql`alter sequence asset_tag_seq restart with 1`); // not owned by a table, so truncate doesn't reset it
  console.log("reset: all tables truncated");
}

/**
 * Shared helpers import "server-only", a marker that throws outside the Next.js server bundler.
 * Seeds run in plain Node (tsx), so neutralise it once before loading module seeds.
 */
function allowServerOnlyImports() {
  const req = createRequire(__filename);
  const id = req.resolve("server-only");
  req.cache[id] = { id, filename: id, loaded: true, exports: {} } as unknown as NodeJS.Module;
}

/** Run the seed. Exported so `npm run demo` can call it in-process. */
export async function runSeed(opts: { reset?: boolean; only?: string[] | null; refreshReference?: boolean } = {}) {
  allowServerOnlyImports();
  if (opts.reset) await resetAll(db);
  await seedReference(db, { refresh: opts.refreshReference });
  // Default approval rules are reference data: every installation gets them, demo or not.
  const policies = path.join(__dirname, "..", "src", "lib", "approvals", "defaults.ts");
  if (existsSync(policies)) {
    const m = (await import(policies)) as { ensureDefaultPolicies: (d: DB) => Promise<void> };
    await m.ensureDefaultPolicies(db);
  }
  for (const name of ["users", "facility", "boq", "procurement", "assets", "cad", "lifts", "approvals", "workorders", "plan", "models", "site", "planning", "money", "commissioning", "safety", "security", "maintenance", "finance", "north", "radiation"]) {
    if (opts.only && !opts.only.includes(name)) continue;
    const file = path.join(__dirname, "seed", `${name}.ts`);
    if (!existsSync(file)) { console.log(`${name}: no seed file yet, skipped`); continue; }
    const mod = (await import(file)) as { default: (d: DB) => Promise<void> };
    await mod.default(db);
    console.log(`${name}: done`);
  }
}

// Run directly: npm run db:seed [-- --reset] [-- --only=facility,boq]
if (/seed\.ts$/.test(process.argv[1] ?? "")) {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  runSeed({ reset: process.argv.includes("--reset"), only: onlyArg ? onlyArg.slice(7).split(",") : null,
    refreshReference: process.argv.includes("--refresh-reference") })
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
