import "server-only";
/**
 * Breached-password check (wave 29), optional (Administration › Settings): asks the Have I Been Pwned password
 * service whether a new password has appeared in known data breaches. Only the first 5 characters of the password's
 * SHA-1 hash leave the server (k-anonymity); the password itself and its full hash never do. If the service can't be
 * reached within 3 seconds (a hospital server without internet), the password is accepted and the check is skipped.
 */
import { createHash } from "node:crypto";
import { getSetting } from "@/lib/settings";
import { breachCount } from "./breached-parse";

export async function breachedProblem(password: string): Promise<string | null> {
  if (!(await getSetting("breachedPasswordCheck"))) return null;
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true", "User-Agent": "Hospital-PAMS" }, signal: AbortSignal.timeout(3000), cache: "no-store",
    });
    if (!res.ok) return null;
    const n = breachCount(await res.text(), hash.slice(5));
    return n > 0 ? `This password has appeared in ${n.toLocaleString("en-GB")} known data leak${n === 1 ? "" : "s"}. Choose another.` : null;
  } catch {
    return null; // no internet, or the service is slow: don't block anyone
  }
}
