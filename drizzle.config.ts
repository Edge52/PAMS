import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env by itself; load it if present (Node 22+).
try { process.loadEnvFile(); } catch { /* no .env file: rely on the environment */ }

// Only `drizzle-kit generate` uses this file (it doesn't connect). Migrations run through `npm run db:migrate`.

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/hpams" },
});
