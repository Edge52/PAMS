import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { PageHeader, Panel } from "@/components/ui";
import { requirePermission } from "@/lib/auth/session";
import { createUser } from "../actions";
import { UserForm } from "../user-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add user" };

export default async function NewUserPage() {
  await requirePermission("users.manage");
  const fac = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).orderBy(asc(facilities.name));
  return (
    <>
      <PageHeader title="Add user" back={{ href: "/admin/users", label: "Users" }} />
      <Panel><UserForm action={createUser} facilities={fac} selected={[]} submitLabel="Add user" /></Panel>
    </>
  );
}
