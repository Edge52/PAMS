import Link from "next/link";
import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Badge, LinkButton, PageHeader } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

const SORT_KEYS = ["name", "email", "role", "lastLogin", "status"] as const;
type UserRow = typeof users.$inferSelect;

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("users.manage");
  const sp = await searchParams;
  // Wave 38: sorted in the query; the key must be on SORT_KEYS.
  const sort = tableSort(sp, SORT_KEYS);
  const way = sort?.dir === "desc" ? desc : asc;
  const order = {
    name: [way(users.name)], email: [way(users.email)], role: [way(users.role), asc(users.name)],
    lastLogin: [sort?.dir === "desc" ? sql`${users.lastLoginAt} desc nulls last` : sql`${users.lastLoginAt} asc nulls first`, asc(users.name)],
    status: [way(users.active), asc(users.name)],
  }[sort?.key ?? "name"];
  const rows = await db.select().from(users).orderBy(...order);
  return (
    <>
      <PageHeader title="Users" description="Who can sign in, and what their role lets them change."
        actions={<LinkButton href="/admin/users/new" variant="primary">Add user</LinkButton>} />
      <DataTable id="users" label="Users" path="/admin/users" sp={sp} sort={sort} rows={rows} rowKey={(u) => u.id} columns={COLUMNS} />
    </>
  );
}

const COLUMNS: Column<UserRow>[] = [
  { key: "name", label: "Name", sort: true,
    cell: (u) => <><Link className="font-semibold text-primary hover:underline" href={`/admin/users/${u.id}`}>{u.name}</Link>{u.jobTitle && <span className="block text-xs text-muted">{u.jobTitle}</span>}</> },
  { key: "email", label: "Email", sort: true, optional: true, cell: (u) => u.email },
  { key: "role", label: "Role", sort: true, cell: (u) => ROLE_LABELS[u.role as Role] ?? u.role },
  { key: "facilities", label: "Facilities", optional: true, cell: (u) => (u.role === "ADMIN" || u.allFacilities ? "All" : "Selected") },
  { key: "lastLogin", label: "Last sign-in", sort: true, optional: true, cell: (u) => (u.lastLoginAt ? formatDate(u.lastLoginAt) : "Never") },
  { key: "twoStep", label: "Two-step", optional: true, cell: (u) => (u.totpEnabledAt ? "On" : "Off") },
  { key: "status", label: "Status", sort: true,
    cell: (u) => (!u.active ? <Badge tone="danger">Switched off</Badge> : !u.passwordHash ? <Badge tone="warn">No password</Badge> : <Badge tone="ok">Active</Badge>) },
];
