import { Suspense, type ReactNode } from "react";
import { SavedFilters } from "@/components/saved-filters";
import { PageHeader } from "@/components/ui";
import { ANALYTICS_TABS } from "@/lib/analytics/core";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { AnalyticsTabBar } from "./tabs";

/** Tabs this user may open (Cost, Procurement and Budget need price access). */
export function tabsFor(role: CurrentUser["role"]) {
  return ANALYTICS_TABS.filter((t) => can(role, t.need));
}

/** Page frame for every Analytics tab: title, short description and the tab bar. Used by app/analytics/layout.tsx. */
export function AnalyticsShell({ me, children }: { me: CurrentUser; children: ReactNode }) {
  const tabs = tabsFor(me.role).map(({ id, label, href }) => ({ id, label, href }));
  return (
    <>
      <PageHeader title="Analytics" description="Figures worked out from the records, each with its formula, period and count. Pick the hospital, department, device type and period below." />
      <Suspense fallback={<div className="mb-5 h-10 border-b border-line" />}><AnalyticsTabBar tabs={tabs} /></Suspense>
      <SavedFilters page="analytics" />
      {children}
    </>
  );
}
