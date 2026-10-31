/**
 * Starts the alert generator in the background: once shortly after startup, then hourly.
 * Called from src/instrumentation.ts (Node runtime only). Timers are unref'd so they never keep a process alive,
 * and a process-wide flag stops a second scheduler (dev hot reloads call register() again).
 */
export const ALERT_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;

const g = globalThis as unknown as { hpamsAlertScheduler?: boolean };

export function startAlertScheduler(): void {
  if (g.hpamsAlertScheduler) return;
  g.hpamsAlertScheduler = true;
  const tick = (trigger: string) => {
    // Imported lazily so nothing touches the database until the first tick.
    import("./alerts").then(({ runAlerts }) => runAlerts(trigger))
      .catch((e) => console.error("[alerts] scheduled run failed:", e));
  };
  setTimeout(() => tick("startup"), STARTUP_DELAY_MS).unref?.();
  setInterval(() => tick("hourly"), ALERT_INTERVAL_MS).unref?.();
}
