import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth/session";
import { Scanner } from "./scanner";

export const metadata = { title: "Scan a label" };

/** Scan a label (wave 26): point a phone at a device's QR label to open its page. */
export default async function ScanPage() {
  await requirePermission("assets.view");
  return (
    <>
      <PageHeader title="Scan a label" description="Point the phone at a device's QR label to open its page: history, faults, safety tests and who to call." />
      <Scanner />
    </>
  );
}
