/**
 * Two-step secrets at rest (audit S13). A secret is stored as "v1:" + base64(iv | tag | ciphertext), AES-256-GCM with
 * a key derived from APP_SECRET. Without APP_SECRET secrets stay as they were (plain), so existing installs keep
 * working; set it to start encrypting — old plain secrets still open and are sealed the next time they are used.
 * Losing APP_SECRET means everyone has to set two-step sign-in up again (an admin can reset it per person).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";

function key(appSecret: string | undefined): Buffer | null {
  if (!appSecret || appSecret.length < 32) return null;
  return createHash("sha256").update(`pams:totp:${appSecret}`).digest();
}

export const isSealed = (stored: string | null | undefined) => !!stored && stored.startsWith(PREFIX);

/** Seal a plain secret for storage; returns it unchanged when no usable APP_SECRET is set. */
export function sealSecret(plain: string, appSecret = process.env.APP_SECRET): string {
  const k = key(appSecret);
  if (!k) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

/** The plain secret from what is stored; null when it is sealed and can't be opened (no or wrong APP_SECRET). */
export function openSecret(stored: string | null | undefined, appSecret = process.env.APP_SECRET): string | null {
  if (!stored) return null;
  if (!isSealed(stored)) return stored;
  const k = key(appSecret);
  if (!k) return null;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Whether APP_SECRET is set well enough to encrypt (shown on the security settings). */
export const canSeal = (appSecret = process.env.APP_SECRET) => key(appSecret) !== null;
