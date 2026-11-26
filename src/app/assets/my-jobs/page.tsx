import { PageHeader } from "@/components/ui";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { loadMyJobs } from "@/lib/assets/my-jobs-server";
import { MyJobs } from "./my-jobs";

export const dynamic = "force-dynamic";
export const metadata = { title: "My jobs" };

/**
 * My jobs (wave 39): a technician's open work orders and planned maintenance, made for a phone. Open it once with
 * signal; after that it works without: notes, labour, parts and completed jobs wait on the phone and are sent later.
 */
export default async function MyJobsPage() {
  const me = await requirePermission("maintenance.edit");
  const data = await loadMyJobs(me, await facilityScope(me));
  return (
    <>
      <PageHeader title="My jobs" description="Your open jobs and planned maintenance. Works without signal once opened: changes are sent when you are back online." />
      <MyJobs initial={data} />
    </>
  );
}
