/**
 * Demo accounts, one per role, all with the password "demo1234", and the setting that lists them on the sign-in
 * page. Skips accounts that already exist. Not run by `db:reset -- --only=none` (real installations use /setup).
 */
import { sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { appSettings, users } from "../../src/db/schema";
import { hashPassword } from "../../src/lib/auth/password";

export const DEMO_PASSWORD = "demo1234";

const PEOPLE: { email: string; name: string; role: (typeof users.$inferInsert)["role"]; jobTitle: string }[] = [
  { email: "admin@demo.hpams", name: "Karim Mansour", role: "ADMIN", jobTitle: "IT administrator" },
  { email: "director@demo.hpams", name: "Dr. Hala Fathy", role: "DIRECTOR", jobTitle: "Hospital director" },
  { email: "procurement@demo.hpams", name: "Omar Saeed", role: "PROCUREMENT", jobTitle: "Procurement manager" },
  // A second procurement user: whoever submits a PO can't approve it, so the manager's step needs someone else.
  { email: "buyer@demo.hpams", name: "Ahmed Fawzy", role: "PROCUREMENT", jobTitle: "Procurement officer" },
  { email: "finance@demo.hpams", name: "Rania Lotfy", role: "FINANCE", jobTitle: "Finance manager" },
  { email: "planner@demo.hpams", name: "Eng. Yasser Nabil", role: "PLANNER", jobTitle: "Planning engineer" },
  { email: "biomedical@demo.hpams", name: "Eng. Sara Hamdy", role: "BIOMEDICAL", jobTitle: "Head of biomedical engineering" },
  { email: "technician@demo.hpams", name: "Mahmoud Ali", role: "TECHNICIAN", jobTitle: "Biomedical technician" },
  { email: "icu@demo.hpams", name: "Dr. Tarek Zaki", role: "DEPARTMENT_HEAD", jobTitle: "Head of ICU" },
  { email: "legal@demo.hpams", name: "Laila Hassan", role: "VIEWER", jobTitle: "Legal adviser" },
  { email: "viewer@demo.hpams", name: "Nour Ibrahim", role: "VIEWER", jobTitle: "Internal auditor" },
];

export default async function seedUsers(db: DB) {
  // Never put known passwords into a real installation: skip when anyone other than demo accounts exists.
  const [{ real }] = (await db.execute<{ real: number }>(sql`select count(*)::int as real from users where email not like '%@demo.hpams'`)).rows;
  if (Number(real) > 0) { console.log("users: real accounts exist, so no demo accounts were added"); return; }
  const hash = await hashPassword(DEMO_PASSWORD);
  let added = 0;
  for (const p of PEOPLE) {
    const res = await db.insert(users).values({ ...p, passwordHash: hash })
      .onConflictDoNothing({ target: users.email }).returning({ id: users.id });
    added += res.length;
  }
  await db.insert(appSettings).values({ key: "demoAccounts", value: true }).onConflictDoNothing();
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from users`)).rows;
  console.log(`users: ${added} demo accounts added (${n} in total), password ${DEMO_PASSWORD}`);
}
