import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, calibrations, deviceTypes, suppliers } from "@/db/schema";
import { Badge, Details, PageHeader, Panel } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { DocumentsPanel } from "@/components/documents-panel";
import { CALIBRATION_RESULT_LABELS, CALIBRATION_RESULT_TONE } from "@/lib/assets/calibration";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calibration" };

/** One calibration record, with its certificate (wave 37). */
export default async function CalibrationRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [r] = await db.select({ c: calibrations, tag: assets.assetTag, typeName: deviceTypes.name, vendor: suppliers.name })
    .from(calibrations).innerJoin(assets, eq(assets.id, calibrations.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(suppliers, eq(suppliers.id, calibrations.vendorId)).where(eq(calibrations.id, Number(id)));
  if (!r) notFound();
  await requireFacilityAccess(r.c.facilityId, me);
  const sp = await searchParams;
  const c = r.c;
  const path = `/assets/calibration/${c.id}`;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={`Calibration of ${r.tag}`} back={{ href: `/assets/${c.assetId}#calibration`, label: r.tag }}
        description={<>{r.typeName} · {formatDate(c.calibratedOn)}</>} />
      <Notice sp={sp} />
      <Panel title="Record" actions={<Badge tone={CALIBRATION_RESULT_TONE[c.result]}>{CALIBRATION_RESULT_LABELS[c.result]}</Badge>}>
        <Details items={[
          { label: "Device", value: <Link href={`/assets/${c.assetId}`} className="font-mono text-primary hover:underline">{r.tag}</Link> },
          { label: "Calibrated on", value: formatDate(c.calibratedOn) },
          { label: "Done by", value: c.performedBy },
          { label: "Company", value: r.vendor ?? "In-house" },
          { label: "Certificate number", value: c.certificateRef },
          { label: "Next due", value: c.nextDue ? `${formatDate(c.nextDue)} (every ${c.intervalMonths} months)` : c.result === "FAIL" ? "When it passes: the device is out of service until then" : null },
          { label: "Notes", value: c.notes },
          { label: "Recorded", value: `${formatDateTime(c.createdAt)}${c.recordedByName ? ` by ${c.recordedByName}` : ""}` },
        ]} />
      </Panel>
      <DocumentsPanel entityType="calibration" entityId={c.id} returnPath={path} title="Certificate" kinds={["calibration_certificate", "service_report", "other"]}
        emptyHint="Scan or photograph the calibration certificate and attach it here." />
    </div>
  );
}
