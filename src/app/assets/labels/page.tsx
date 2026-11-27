import { headers } from "next/headers";
import QRCode from "qrcode";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/assets/print-button";
import { parseIds } from "@/lib/assets/filters";
import { assetsByIds } from "@/lib/assets/queries";
import { isLocalOrigin, labelUrl } from "@/lib/assets/rounds";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { idCards } from "@/lib/compliance/id-card-server";
import { todayISO } from "@/lib/format";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { labelGs1Line } from "@/lib/assets/gs1";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asset labels" };

/** Printable sheet of asset labels (A4, 3 × 7 = 63.5 × 38.1 mm, the common L7160 layout). QR = the scan URL with the tag. */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const ids = parseIds(sp.ids, 210);
  const list = await assetsByIds(ids, await facilityScope(me));
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // APP_URL (e.g. https://pams.hospital.eg) makes printed labels point at the real server, whichever address printed them.
  const origin = (process.env.APP_URL || `${proto}://${host}`).replace(/\/+$/, "");
  const appUrlSet = !!process.env.APP_URL?.trim();
  const local = isLocalOrigin(origin);
  // Wave 40: the vendor's service line on labels of devices whose ID card says so (or every label with ?service=1).
  const allService = sp.service === "1";
  const cards = await idCards(list.map((a) => a.id), todayISO());
  // Wave 41: the GS1 UDI as a printed line (?gs1=1). The QR stays the scan link; a DataMatrix needs a barcode library.
  const withGs1 = sp.gs1 === "1";
  const udis = withGs1 && list.length
    ? new Map((await db.select({ id: assets.id, di: assets.udiDi, pi: assets.udiPi }).from(assets).where(inArray(assets.id, list.map((a) => a.id)))).map((u) => [u.id, labelGs1Line(u.di, u.pi)]))
    : new Map<number, string | null>();
  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams({ ids: list.map((a) => a.id).join(","), ...(allService ? { service: "1" } : {}), ...(withGs1 ? { gs1: "1" } : {}) });
    for (const [k, v] of Object.entries(over)) if (v == null) p.delete(k); else p.set(k, v);
    return `/assets/labels?${p.toString()}`;
  };
  const labels = await Promise.all(list.map(async (a) => ({
    a,
    // The QR holds the tag only (audit B4): a database id can point at another device after a re-import.
    svg: await QRCode.toString(labelUrl(origin, a.assetTag), { type: "svg", margin: 0, errorCorrectionLevel: "M" }),
  })));

  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm 7mm; }
        @media print {
          #side-nav, button[aria-controls="side-nav"], .no-print { display: none !important; }
          main { padding: 0 !important; }
          body { background: white; }
          .label-sheet { gap: 0 2.5mm !important; }
          .label { break-inside: avoid; border-color: transparent !important; }
        }
      `}</style>
      <div className="no-print">
        <PageHeader title="Asset labels" back={{ href: "/assets", label: "Asset register" }}
          description={list.length ? `${list.length} label${list.length === 1 ? "" : "s"} · A4 sheet, 3 × 7 labels of 63.5 × 38.1 mm. Scan the QR code to open the asset.` : undefined}
          actions={list.length ? <PrintButton label={`Print ${list.length} label${list.length === 1 ? "" : "s"}`} /> : undefined} />
        {list.length > 0 && (local || !appUrlSet) && (
          <p role={local ? "alert" : "status"} className={`mb-4 max-w-3xl rounded-[var(--radius-control)] border px-3 py-2 text-sm ${local ? "border-danger bg-danger-soft text-danger" : "border-warn bg-warn-soft text-warn"}`}>
            {local
              ? <><b>Labels point to localhost: set APP_URL to the address phones use.</b> Phones can&apos;t open {origin}. Don&apos;t print these labels yet.</>
              : <>APP_URL is not set, so labels point to {origin}, the address this page was opened on. Set APP_URL if phones use another address.</>}
          </p>
        )}
        {list.length > 0 && (
          <p className="mb-4 flex flex-wrap gap-x-4 text-sm"><a href={qs({ service: allService ? null : "1" })} className="text-primary hover:underline">
            {allService ? "Show the service line only where the ID card asks for it" : "Show the vendor's service line on every label"}</a>
            <a href={qs({ gs1: withGs1 ? null : "1" })} className="text-primary hover:underline">{withGs1 ? "Hide the GS1 UDI line" : "Add the GS1 UDI line (devices with a UDI)"}</a></p>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState title="No assets chosen" action={<LinkButton href="/assets" variant="primary">Choose assets in the register</LinkButton>}>
          Tick assets in the register and press “Print labels for selected”, or use Print label on an asset page.
        </EmptyState>
      ) : (
        <div className="label-sheet grid w-fit grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
          {labels.map(({ a, svg }) => (
            <div key={a.id} className="label flex h-[38.1mm] w-[63.5mm] items-center gap-[2.5mm] overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface px-[2.5mm] text-ink">
              <div className="size-[30mm] shrink-0 [&>svg]:size-full" aria-label={`QR code for ${a.assetTag}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />
              <div className="min-w-0 leading-tight">
                <p className="text-[6.5pt] font-semibold text-muted">{a.facilityCode} · property of the hospital</p>
                <p className="mt-0.5 font-mono text-[9.5pt] font-bold tracking-tight">{a.assetTag}</p>
                <p className="mt-1 line-clamp-2 text-[7pt] font-semibold">{a.deviceTypeName}</p>
                <p className="truncate text-[6.5pt]">{[a.manufacturer, a.model].filter(Boolean).join(" ")}</p>
                {a.serialNumber && <p className="truncate font-mono text-[6.5pt]">S/N {a.serialNumber}</p>}
                <p className="mt-0.5 truncate text-[6.5pt] text-muted">{a.departmentName ?? ""}{a.roomCode ? ` · ${a.roomCode}` : ""}</p>
                {udis.get(a.id) && <p className="break-all font-mono text-[5.5pt] leading-none" title="GS1 UDI, human-readable">{udis.get(a.id)}</p>}
                {(allService || cards.get(a.id)?.showOnLabel) && cards.get(a.id)?.vendor.phone && <p className="truncate text-[6.5pt] font-semibold">Service {cards.get(a.id)!.vendor.phone}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
