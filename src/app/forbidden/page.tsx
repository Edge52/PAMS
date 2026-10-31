import { LinkButton, PageHeader, Panel } from "@/components/ui";
import { PERMISSION_LABELS, ROLE_LABELS, type Permission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "No access" };

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const me = await requireUser();
  const { need } = await searchParams;
  const what = need === "facility" ? "see that facility" : PERMISSION_LABELS[need as Permission] ?? "do that";
  return (
    <>
      <PageHeader title="You don't have access to this" />
      <Panel>
        <p className="text-sm">You&apos;re signed in as <strong>{me.name}</strong> ({ROLE_LABELS[me.role]}). Your role can&apos;t {what}.</p>
        <p className="mt-2 text-sm text-muted">If you need it for your work, ask an administrator to change your role.</p>
        <div className="mt-4"><LinkButton href="/">Back to the dashboard</LinkButton></div>
      </Panel>
    </>
  );
}
