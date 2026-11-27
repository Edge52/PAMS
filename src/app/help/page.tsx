import { PageHeader } from "@/components/ui";
import { HelpGuides } from "@/components/help/help-guides";
import { permissionsOf } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { guidesFor } from "@/lib/help";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help" };

/** Task guides (wave 41): short steps with links, only the ones this role can follow. */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const guides = guidesFor(permissionsOf(me.role));
  return (
    <>
      <PageHeader title="Help" description="Short guides to common tasks. Each step links to the page where you do it. You see the guides your role can follow." />
      <HelpGuides guides={guides} initial={typeof sp.q === "string" ? sp.q.slice(0, 80) : ""} />
      <p className="mt-6 text-sm text-muted">Press Ctrl+K (⌘K on a Mac) to jump to any page by name.</p>
    </>
  );
}
