/**
 * Two-step sign-in codes (wave 25): time-based one-time passwords, RFC 6238 (HMAC-SHA1, 6 digits, 30 seconds),
 * the kind every authenticator app reads. Pure: no database, no clock of its own.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, as the base32 text an authenticator app takes. */
export function newSecret(): string { return base32Encode(randomBytes(20)); }

/** The code for one 30-second step. */
export function codeAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const stepOf = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Check a typed code. One step either side is allowed (a slow typist, a clock a little off). Returns the step that
 * matched, or null. `lastStep` is the step of the last code this account used: that one and older are refused, so
 * a code seen over a shoulder can't be used again.
 */
export function verifyCode(secret: string, typed: string, nowMs: number, lastStep: number | null = null): number | null {
  const code = typed.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepOf(nowMs);
  for (const step of [now, now - 1, now + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    const want = Buffer.from(codeAt(secret, step)), got = Buffer.from(code);
    if (timingSafeEqual(want, got)) return step;
  }
  return null;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUrl(secret: string, account: string, issuer = "Hospital PAMS"): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** Ten one-use backup codes, shown once: "xxxx-xxxx" from letters and digits that can't be confused. */
export function newBackupCodes(n = 10): string[] {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => A[x % A.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const normalBackupCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
