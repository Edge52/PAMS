/**
 * First administrator (wave 36, audit S10).
 *
 * - `setupCodeRule`: on a server (NODE_ENV=production with PostgreSQL) setup needs SETUP_CODE, so whoever reaches
 *   /setup first can't make themselves administrator. Without the code there, setup stays locked. The embedded
 *   database (demo, laptop) runs on this computer only unless LAN=1, so the code stays optional there.
 * - `claimFirstAdmin`: the check "no administrator yet" and the write happen in one transaction under an advisory
 *   lock, so two setups sent at the same moment can't both create an administrator.
 * Relative imports so it can be unit tested.
 */
import { count, eq, isNotNull, sql } from "drizzle-orm";
import type { DB } from "../db";
import { users } from "../db/schema";

/** Any fixed number, the same in every app instance. */
const SETUP_LOCK_KEY = 4_152_037;

export function setupCodeRule(env: Record<string, string | undefined>): { ask: boolean; locked: boolean } {
  if (env.SETUP_CODE) return { ask: true, locked: false };
  const embedded = (env.DATABASE_URL || "pglite:").startsWith("pglite:");
  return { ask: false, locked: env.NODE_ENV === "production" && !embedded };
}

/** Makes the first administrator; null when one already exists (someone else finished setup first). */
export async function claimFirstAdmin(d: DB, a: { name: string; email: string; passwordHash: string }): Promise<number | null> {
  return d.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
    const [r] = await tx.select({ n: count() }).from(users).where(isNotNull(users.passwordHash));
    if ((r?.n ?? 0) > 0) return null;
    const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${a.email}`);
    if (existing) {
      await tx.update(users).set({ name: a.name, role: "ADMIN", active: true, passwordHash: a.passwordHash }).where(eq(users.id, existing.id));
      return existing.id;
    }
    const [{ id }] = await tx.insert(users).values({ name: a.name, email: a.email, role: "ADMIN", passwordHash: a.passwordHash }).returning({ id: users.id });
    return id;
  });
}
