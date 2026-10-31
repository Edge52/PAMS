import { asc } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { QuickStartWizard } from "@/components/boq/quick-start-wizard";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { CURRENCIES } from "@/lib/format";
import { scopeWhere } from "@/lib/assets/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "BOQ quick start" };

export default async function QuickStartPage() {
  const me = await requirePermission("boq.view");
  const scope = await facilityScope(me);
  const facs = await db.select({ value: facilities.id, label: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  return (
    <>
      <PageHeader title="BOQ quick start" back={{ href: "/boq", label: "BOQs" }}
        description="Answer a few questions about the hospital and get a complete, priced BOQ from the standard — every quantity still shows its calculation." />
      {can(me.role, "boq.edit")
        ? <QuickStartWizard facilities={facs} currencies={CURRENCIES} />
        : <EmptyState title="Only BOQ planners can create BOQs" action={<LinkButton href="/boq">See the BOQs</LinkButton>}>Ask a planner or biomedical engineer to run the quick start.</EmptyState>}
    </>
  );
}
