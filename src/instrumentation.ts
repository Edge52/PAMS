/**
 * Next.js calls register() once when a server starts. We use it to start the hourly alert generator.
 * - Node runtime only (the generator needs the database driver).
 * - Not during `next build`, and not when ALERTS_DISABLED=1 (e.g. a second app instance; alerts are idempotent anyway).
 * - No database work at import time or inside register(): the first run is scheduled a few seconds after start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.ALERTS_DISABLED === "1") return;
  const { startAlertScheduler } = await import("./lib/notifications/scheduler");
  startAlertScheduler();
}
