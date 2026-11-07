import { describe, expect, it } from "vitest";
import { dumpError, pgDumpEnv } from "./backup-env";

describe("pg_dump environment", () => {
  it("takes the connection out of the URL, decoding the password", () => {
    expect(pgDumpEnv("postgres://hpams:p%40ss%2Fw@db:5432/hpams")).toEqual({ PGHOST: "db", PGPORT: "5432", PGUSER: "hpams", PGPASSWORD: "p@ss/w", PGDATABASE: "hpams" });
  });
  it("follows DATABASE_SSL over the URL's sslmode, with the CA file", () => {
    const u = "postgresql://postgres.abc:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=disable";
    expect(pgDumpEnv(u).PGSSLMODE).toBe("disable");
    expect(pgDumpEnv(u, "no-verify").PGSSLMODE).toBe("require");
    expect(pgDumpEnv(u, "verify", "/etc/ca.pem")).toMatchObject({ PGSSLMODE: "verify-full", PGSSLROOTCERT: "/etc/ca.pem", PGUSER: "postgres.abc" });
  });
  it("refuses anything that isn't PostgreSQL", () => {
    expect(() => pgDumpEnv("mysql://x@y/z")).toThrow();
  });
  it("picks the useful line of pg_dump's errors", () => {
    expect(dumpError("pg_dump: error: connection to server failed: FATAL: password authentication failed\n")).toMatch(/^connection to server failed/);
    expect(dumpError("pg_dump: error: aborting because of server version mismatch\npg_dump: detail: server version: 17.2; pg_dump version: 16.4")).toMatch(/PG_DUMP_PATH/);
    expect(dumpError("")).toMatch(/without saying why/);
  });
});
