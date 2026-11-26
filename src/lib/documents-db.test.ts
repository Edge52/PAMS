/**
 * Wave 39 (agent C): document versions and soft delete, against in-memory PGlite with the real migrations.
 * Uploading to an existing document keeps the old file as a version; removing hides it and keeps the files;
 * an administrator restores or purges (files go only when nothing else uses them).
 *
 * Skipped until the migration with the wave 39 tables exists in drizzle/ (the lead generates it at merge time).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import type { DB } from "../db";

const h = vi.hoisted(() => {
  process.env.UPLOAD_DIR = `${process.env.TMPDIR ?? "/tmp"}/hpams-w39c-${process.pid}-${Date.now()}`;
  return { d: null as unknown as DB, me: { id: 1, name: "Tester", email: "t@test.hpams", role: "ADMIN" as string, jobTitle: null, allFacilities: true } };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../db/schema"));
vi.mock("./server-utils", () => ({ logActivity: async () => {} }));
vi.mock("./auth/session", () => ({
  requirePermission: async () => h.me, requireUser: async () => h.me, getCurrentUser: async () => h.me,
  requireFacilityAccess: async () => {}, facilityScope: async () => null,
}));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.document_versions')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

const form = (o: Record<string, string | number | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v instanceof File ? v : String(v)); return f; };
const file = (name: string, text: string) => new File([text], name, { type: "application/pdf" });
const onDisk = (url: string) => existsSync(path.join(process.env.UPLOAD_DIR!, ...url.slice("/files/".length).split("/").map(decodeURIComponent)));

describe.skipIf(!ready)("document versions and removal (wave 39)", async () => {
  const docs = await import("./documents");
  const access = await import("./documents-access");
  const { documents, documentVersions, suppliers, users } = schema;
  let supplierId = 0, docId = 0;

  it("sets up", async () => {
    await d.insert(users).values({ id: 1, name: "Tester", email: "t@test.hpams", role: "ADMIN" }).onConflictDoNothing();
    [{ id: supplierId }] = await d.insert(suppliers).values({ name: "Versions Ltd" }).returning({ id: suppliers.id });
  });

  it("attaches, then keeps the old file as a version when a new one is uploaded", async () => {
    const base = { entityType: "supplier", entityId: supplierId, returnPath: "/procurement/suppliers/1" };
    expect((await docs.uploadDocument(null, form({ ...base, kind: "licence", file: file("licence.pdf", "one"), note: "First copy" })))?.ok).toMatch(/attached/);
    const [doc] = await access.listDocuments("supplier", supplierId);
    docId = doc.id;
    expect(doc).toMatchObject({ version: 1, note: "First copy", uploadedByName: "Tester", kind: "licence" });
    expect((await docs.uploadDocument(null, form({ ...base, documentId: docId, file: file("licence-2027.pdf", "two"), note: "Renewed" })))?.ok).toMatch(/new version/);
    const [now] = await access.listDocuments("supplier", supplierId);
    expect(now).toMatchObject({ id: docId, version: 2, fileName: "licence-2027.pdf", note: "Renewed", kind: "licence" });
    const versions = await access.listVersions([docId]);
    expect(versions.map((v) => [v.version, v.fileName, v.note, v.uploadedByName])).toEqual([[1, "licence.pdf", "First copy", "Tester"]]);
    expect(onDisk(versions[0].url) && onDisk(now.url)).toBe(true);
    // A third upload numbers on.
    await docs.uploadDocument(null, form({ ...base, documentId: docId, file: file("licence-2028.pdf", "three") }));
    expect((await access.listVersions([docId])).map((v) => v.version)).toEqual([2, 1]);
  });

  it("refuses a new version for another record's document", async () => {
    expect((await docs.uploadDocument(null, form({ entityType: "supplier", entityId: supplierId + 999, documentId: docId, file: file("x.pdf", "x") })))?.error).toBeDefined();
  });

  it("hides a removed document, keeps its files, and lists it for administrators", async () => {
    await docs.deleteDocument(form({ id: docId, returnPath: "/" }));
    expect(await access.listDocuments("supplier", supplierId)).toEqual([]);
    const [row] = await d.select().from(documents).where(eq(documents.id, docId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(1);
    expect(onDisk(row.url)).toBe(true);
    expect((await access.listDeletedDocuments()).map((x) => [x.id, x.deletedByName])).toEqual([[docId, "Tester"]]);
  });

  it("restores", async () => {
    await docs.restoreDocument(form({ id: docId }));
    expect((await access.listDocuments("supplier", supplierId)).map((x) => x.id)).toEqual([docId]);
    expect(await access.listDeletedDocuments()).toEqual([]);
  });

  it("purges only removed documents, with their versions and unshared files", async () => {
    await docs.purgeDocument(form({ id: docId }));
    expect((await d.select().from(documents).where(eq(documents.id, docId))).length).toBe(1); // not removed: nothing happens
    const [row] = await d.select().from(documents).where(eq(documents.id, docId));
    const olds = await d.select().from(documentVersions).where(eq(documentVersions.documentId, docId));
    // Another document sharing the first version's file (as work orders share 3D note photos) keeps it.
    await d.insert(documents).values({ entityType: "supplier", entityId: supplierId, fileName: "shared.pdf", url: olds.find((v) => v.version === 1)!.url });
    await docs.deleteDocument(form({ id: docId, returnPath: "/" }));
    await docs.purgeDocument(form({ id: docId }));
    expect((await d.select().from(documents).where(eq(documents.id, docId))).length).toBe(0);
    expect((await d.select().from(documentVersions).where(eq(documentVersions.documentId, docId))).length).toBe(0);
    expect(onDisk(row.url)).toBe(false);
    expect(onDisk(olds.find((v) => v.version === 2)!.url)).toBe(false);
    expect(onDisk(olds.find((v) => v.version === 1)!.url)).toBe(true);
  });
});
