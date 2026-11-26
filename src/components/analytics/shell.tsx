/** Stand-in (wave 40, agent F) for agent E's Analytics shell: the lead keeps E's version at merge. */
import type { ReactNode } from "react";
import { PageHeader, TabLinks } from "@/components/ui";
import { ANALYTICS_TABS, type AnalyticsTabId } from "@/lib/analytics/core";

export function AnalyticsShell({ active, title, children }: { active: AnalyticsTabId; title: string; children: ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <TabLinks active={active} tabs={ANALYTICS_TABS.map((t) => ({ key: t.id, label: t.label, href: t.href }))} />
      {children}
    </>
  );
}
