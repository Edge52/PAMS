import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { findLabel } from "@/lib/assets/label-server";
import { parseScan } from "@/lib/assets/rounds";
import { Scanner } from "./scanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan a label" };

/**
 * Scan a label (wave 26): point a phone at a device's QR label to open its page. Printed labels open
 * `/scan?tag=<tag>` (audit B4), which goes straight to the device with that tag.
 */
export default async function ScanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const raw = typeof sp.tag === "string" ? sp.tag.trim() : "";
  const scan = raw ? parseScan(raw) : null;
  const hit = scan?.tag ? await findLabel({ tag: scan.tag }, await facilityScope(me)) : null;
  if (hit) redirect(`/assets/${hit.id}`);
  return (
    <>
      <PageHeader title="Scan a label" description="Point the phone at a device's QR label to open its page: history, faults, safety tests and who to call." />
      {raw && <p role="alert" className="mb-4 max-w-md text-sm font-semibold text-danger">No device with the tag “{raw.slice(0, 60)}” in the register for your hospitals. Check the label, or type the tag.</p>}
      <Scanner />
    </>
  );
}
