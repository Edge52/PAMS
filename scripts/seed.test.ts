/**
 * CO-01 (audit, wave 30): the start-up seed must never overwrite reference data an administrator has edited.
 * Runs the real reference seed twice against an in-memory PGlite database with the real migrations.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";

vi.mock("server-only", () => ({}));

const { boqRules, deviceTypes, standardSets } = schema;
let client: PGlite;
let d: DB;
let seedReference: (d: DB, opts?: { refresh?: boolean }) => Promise<void>;

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "drizzle") });
  ({ seedReference } = await import("./seed"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seedReference(d);
}, 180_000);

afterAll(async () => { await client?.close(); });

describe("start-up reference seed (CO-01)", () => {
  it("keeps edited device types, BOQ rules, throughput rates and the default standard set", async () => {
    const [mon] = await d.select().from(deviceTypes).where(eq(deviceTypes.code, "MON-PAT-HIGH"));
    expect(mon).toBeDefined();
    await d.update(deviceTypes).set({ lifeExpectancyYears: 3, ppmIntervalMonths: 1, riskClass: "III" }).where(eq(deviceTypes.id, mon.id));
    const [rule] = await d.select().from(boqRules).orderBy(boqRules.id).limit(1);
    await d.update(boqRules).set({ ratio: 9.5, tier: "OPTIONAL" }).where(eq(boqRules.id, rule.id));
    const [tp] = await d.select().from(boqRules).where(eq(boqRules.param, "PROCEDURES_PER_DAY")).limit(1);
    const throughputRule = tp ?? (await d.select().from(boqRules).orderBy(boqRules.id)).find((r) => r.param !== null);
    expect(throughputRule).toBeDefined();
    await d.update(boqRules).set({ param: null, paramRatio: null }).where(eq(boqRules.id, throughputRule!.id));
    const sets = await d.select().from(standardSets).orderBy(standardSets.id);
    expect(sets.length).toBeGreaterThan(1);
    for (const s of sets) await d.update(standardSets).set({ isDefault: !s.isDefault }).where(eq(standardSets.id, s.id));
    const ruleCount = (await d.select().from(boqRules)).length;

    await seedReference(d); // a restart or an update

    const [mon2] = await d.select().from(deviceTypes).where(eq(deviceTypes.id, mon.id));
    expect([mon2.lifeExpectancyYears, mon2.ppmIntervalMonths, mon2.riskClass]).toEqual([3, 1, "III"]);
    const [rule2] = await d.select().from(boqRules).where(eq(boqRules.id, rule.id));
    expect([rule2.ratio, rule2.tier]).toEqual([9.5, "OPTIONAL"]);
    const [tp2] = await d.select().from(boqRules).where(eq(boqRules.id, throughputRule!.id));
    expect(tp2.param).toBeNull();
    const sets2 = await d.select().from(standardSets).orderBy(standardSets.id);
    expect(sets2.map((s) => s.isDefault)).toEqual(sets.map((s) => !s.isDefault));
    expect((await d.select().from(boqRules)).length).toBe(ruleCount);
  }, 180_000);

  it("overwrites from seed-data only on an explicit refresh", async () => {
    await seedReference(d, { refresh: true });
    const [mon] = await d.select().from(deviceTypes).where(eq(deviceTypes.code, "MON-PAT-HIGH"));
    expect(mon.lifeExpectancyYears).not.toBe(3);
  }, 180_000);
});
