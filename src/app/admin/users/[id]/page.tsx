import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, userFacilities, users } from "@/db/schema";
import { Field, Input, PageHeader, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requirePermission } from "@/lib/auth/session";
import { resetPassword, updateUser } from "../actions";
import { UserForm } from "../user-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "User" };

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requirePermission("users.manage");
  const id = Number((await params).id);
  const { created } = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) notFound();
  const [fac, sel] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name }).from(facilities).orderBy(asc(facilities.name)),
    db.select({ id: userFacilities.facilityId }).from(userFacilities).where(eq(userFacilities.userId, id)),
  ]);
  return (
    <>
      <PageHeader title={u.name} description={u.email} back={{ href: "/admin/users", label: "Users" }} />
      {created && <p className="mb-4 rounded-[var(--radius-control)] bg-ok-soft px-3 py-2 text-sm text-ok">User added. Give them the temporary password in person.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Details" className="lg:col-span-2">
          <UserForm action={updateUser} user={u} facilities={fac} selected={sel.map((s) => s.id)} submitLabel="Save" />
        </Panel>
        <Panel title="Reset password">
          <ActionForm action={resetPassword} className="space-y-4">
            <input type="hidden" name="id" value={u.id} />
            <Field label="New temporary password" hint="Signs them out everywhere"><Input type="text" name="password" required autoComplete="off" /></Field>
            <SubmitButton variant="secondary">Reset password</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
