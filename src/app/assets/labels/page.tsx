import { headers } from "next/headers";
import QRCode from "qrcode";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/assets/print-button";
import { parseIds } from "@/lib/assets/filters";
import { assetsByIds } from "@/lib/assets/queries";
import { facilityScope, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asset labels" };

/** Printable sheet of asset labels (A4, 3 × 7 = 63.5 × 38.1 mm, the common L7160 layout). QR = asset URL + tag. */
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
  const labels = await Promise.all(list.map(async (a) => ({
    a,
    svg: await QRCode.toString(`${origin}/assets/${a.id}?tag=${encodeURIComponent(a.assetTag)}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }),
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
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
