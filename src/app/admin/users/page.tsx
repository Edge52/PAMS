import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Badge, LinkButton, PageHeader, Table, Td, Th, THead } from "@/components/ui";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

export default async function UsersPage() {
  await requirePermission("users.manage");
  const rows = await db.select().from(users).orderBy(asc(users.name));
  return (
    <>
      <PageHeader title="Users" description="Who can sign in, and what their role lets them change."
        actions={<LinkButton href="/admin/users/new" variant="primary">Add user</LinkButton>} />
      <Table>
        <THead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Facilities</Th><Th>Last sign-in</Th><Th>Status</Th></tr></THead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-t border-line">
              <Td><Link className="font-semibold text-primary hover:underline" href={`/admin/users/${u.id}`}>{u.name}</Link>{u.jobTitle && <span className="block text-xs text-muted">{u.jobTitle}</span>}</Td>
              <Td>{u.email}</Td>
              <Td>{ROLE_LABELS[u.role as Role] ?? u.role}</Td>
              <Td>{u.role === "ADMIN" || u.allFacilities ? "All" : "Selected"}</Td>
              <Td>{u.lastLoginAt ? formatDate(u.lastLoginAt) : "Never"}</Td>
              <Td>{!u.active ? <Badge tone="danger">Switched off</Badge> : !u.passwordHash ? <Badge tone="warn">No password</Badge> : <Badge tone="ok">Active</Badge>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
