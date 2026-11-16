/** The "scan this square" part of setting up two-step sign-in (wave 25). Server component: the secret never goes to client code. */
import QRCode from "qrcode";
import { otpauthUrl } from "@/lib/auth/totp";

export async function TwoStepSetup({ secret, email }: { secret: string; email: string }) {
  const qr = await QRCode.toDataURL(otpauthUrl(secret, email), { margin: 1, width: 200 });
  return (
    <ol className="mb-5 list-decimal space-y-3 pl-5 text-sm">
      <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, or any other).</li>
      <li>
        Scan this square with the app.
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} width={200} height={200} alt="QR code to set up two-step sign-in. If you can't scan it, type the key below into the app." className="mt-2 rounded-[var(--radius-control)] border border-line bg-white p-1" />
        <span className="mt-2 block text-xs text-muted">Can&apos;t scan? Type this key into the app: <span className="font-mono text-ink [overflow-wrap:anywhere]">{secret.replace(/(.{4})/g, "$1 ").trim()}</span></span>
      </li>
      <li>Type the 6-digit code the app shows.</li>
    </ol>
  );
}
