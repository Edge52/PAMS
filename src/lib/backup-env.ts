/**
 * The environment for `pg_dump` (wave 14), from DATABASE_URL and the DATABASE_SSL settings. The connection goes in
 * libpq's PG* variables rather than on the command line, so the password never shows in the server's process list.
 * Pure.
 */
export function pgDumpEnv(url: string, ssl?: string, caFile?: string): Record<string, string> {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("DATABASE_URL isn't a PostgreSQL address.");
  const env: Record<string, string> = {};
  if (u.hostname) env.PGHOST = decodeURIComponent(u.hostname);
  if (u.port) env.PGPORT = u.port;
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (dbName) env.PGDATABASE = dbName;
  const mode = u.searchParams.get("sslmode");
  // DATABASE_SSL wins over the URL's sslmode, as it does for the app's own connection (src/db/index.ts).
  if (ssl) env.PGSSLMODE = ssl === "no-verify" ? "require" : "verify-full";
  else if (mode) env.PGSSLMODE = mode;
  if (ssl && ssl !== "no-verify" && caFile) env.PGSSLROOTCERT = caFile;
  // Supabase and other poolers: a project name passed as an option (e.g. ?options=project%3Dabc).
  const options = u.searchParams.get("options");
  if (options) env.PGOPTIONS = options;
  return env;
}

/** The first useful line of pg_dump's error output, for the page. */
export function dumpError(stderr: string): string {
  const line = stderr.split("\n").map((l) => l.replace(/^pg_dump:\s*(error:\s*)?/, "").trim()).find((l) => l && !/^detail:|^hint:/i.test(l));
  if (!line) return "pg_dump stopped without saying why.";
  if (/server version mismatch|aborting because of server version mismatch/i.test(line)) return `${line} Install a pg_dump at least as new as the database server (PostgreSQL client tools), or set PG_DUMP_PATH.`;
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}
