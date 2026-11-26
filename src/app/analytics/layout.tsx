import type { ReactNode } from "react";
import { AnalyticsShell } from "@/components/analytics/shell";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AnalyticsLayout({ children }: { children: ReactNode }) {
  const me = await requirePermission("reports.view");
  return <AnalyticsShell me={me}>{children}</AnalyticsShell>;
}
