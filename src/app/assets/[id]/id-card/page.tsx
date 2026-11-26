import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/assets/print-button";
import { assetsByIds, ppmInfo } from "@/lib/assets/queries";
import { labelUrl } from "@/lib/assets/rounds";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { idCards } from "@/lib/compliance/id-card-server";
import { formatDate, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment ID card" };

/** Printable equipment ID card (wave 40, GAHAR 2025 standards EFS.10 EOC 4): identity, who to call, the QR code. */
export default async function IdCardPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [a] = await assetsByIds([Number(id)], await facilityScope(me));
  if (!a) notFound();
  const today = todayISO();
  const [card, ppm] = await Promise.all([idCards([a.id], today).then((m) => m.get(a.id)!), ppmInfo([a.id]).then((m) => m.get(a.id))]);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = (process.env.APP_URL || `${proto}://${host}`).replace(/\/+$/, "");
  const svg = await QRCode.toString(labelUrl(origin, a.assetTag), { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const line = (label: string, value: string | null | undefined) => (
    <div className="flex gap-2 border-b border-line py-1"><dt className="w-36 shrink-0 text-muted">{label}</dt><dd className="font-semibold">{value || "—"}</dd></div>
  );
  return (
    <>
      <style>{`
        @page { size: A5 landscape; margin: 8mm; }
        @media print {
          #side-nav, button[aria-controls="side-nav"], .no-print { display: none !important; }
          main { padding: 0 !important; }
          body { background: white; }
          .id-card { box-shadow: none !important; }
        }
      `}</style>
      <div className="no-print">
        <PageHeader title="Equipment ID card" back={{ href: `/assets/${a.id}`, label: a.assetTag }} actions={<PrintButton label="Print ID card" />}
          description="Print it on card and keep it with the device (A5). The QR code opens the device's page." />
      </div>
      <article className="id-card flex max-w-[190mm] gap-6 rounded-[var(--radius-panel)] border-2 border-ink bg-surface p-5 text-[12.5px] text-ink">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted">{a.facilityCode} · Equipment ID card</p>
          <h1 className="mb-2 font-mono text-xl font-bold">{a.assetTag}</h1>
          <dl>
            {line("Device", a.deviceTypeName)}
            {line("Maker and model", [a.manufacturer, a.model].filter(Boolean).join(" "))}
            {line("Serial number", a.serialNumber)}
            {line("Location", [a.departmentName, a.roomCode].filter(Boolean).join(" · "))}
            {line("Installed", a.installDate ? formatDate(a.installDate) : null)}
            {line("Warranty until", a.warrantyEnd ? formatDate(a.warrantyEnd) : null)}
            {line("Last PPM", ppm?.lastPpm ? formatDate(ppm.lastPpm) : null)}
          </dl>
          <h2 className="mt-3 text-sm font-bold">If it fails</h2>
          <dl>
            {line("In-house contact", [card.inHouseName, card.inHousePhone].filter(Boolean).join(" · "))}
            {line("Vendor emergency line", [card.vendor.phone, card.vendor.name].filter(Boolean).join(" · "))}
            {line("Service contract", card.contractNumber ? `${card.contractNumber}${card.contractEnd ? `, to ${formatDate(card.contractEnd)}` : ""}` : "None running")}
          </dl>
          <p className="mt-2 text-[10px] text-muted">Report faults in PAMS by scanning the code. Printed {formatDate(today)}.</p>
        </div>
        <div className="w-[38mm] shrink-0">
          <div className="size-[38mm] [&>svg]:size-full" role="img" aria-label={`QR code for ${a.assetTag}`} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </article>
    </>
  );
}
