/** Audit wave 30, S16: a broken % escape in a /files address is "not found", not a server error. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/lib/auth/permissions", () => ({ can: () => true }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => ({ id: 1, name: "T", role: "ADMIN" }), facilityScope: async () => null }));
vi.mock("@/lib/documents-access", () => ({ canViewDocumentsOf: async () => false }));
vi.mock("@/lib/storage", () => ({ fileKind: () => null, resolveStored: () => null }));
vi.mock("@/lib/safe-path", () => import("./safe-path"));

describe("/files with a malformed address (S16)", () => {
  it("answers 404 instead of throwing", async () => {
    const { GET } = await import("../app/files/[...path]/route");
    const res = await GET(new Request("http://x/files/offer/1/%E0"), { params: Promise.resolve({ path: ["offer", "1", "%E0"] }) });
    expect(res.status).toBe(404);
  });
});
