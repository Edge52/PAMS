/**
 * The address a request came from, for the audit log, "Your sessions" and sign-in throttling (audit wave 30, S6).
 * Pure: pass the request headers.
 *
 * - TRUST_PROXY=1 (behind our proxy, Caddy): the LAST X-Forwarded-For hop. The proxy appends the address it saw;
 *   anything before it was sent by the client and can be made up.
 * - Otherwise there is no proxy of ours, so a client-sent X-Forwarded-For list is ignored. Next.js itself puts the
 *   socket's address in X-Forwarded-For when the client sent none, so a single bare IP address is used. (A client
 *   talking straight to the app can still send one made-up address; set TRUST_PROXY=1 behind a proxy.)
 */
import { isIP } from "node:net";

type HeaderSource = { get(name: string): string | null };

export function clientAddress(h: HeaderSource, trustProxy: boolean): string | null {
  const xff = h.get("x-forwarded-for") ?? "";
  if (trustProxy) {
    const hops = xff.split(",").map((x) => x.trim()).filter(Boolean);
    const ip = hops.at(-1) ?? h.get("x-real-ip")?.trim() ?? "";
    return ip ? ip.slice(0, 64) : null;
  }
  const one = xff.trim();
  return one && !one.includes(",") && isIP(one) ? one : null;
}

/** TRUST_PROXY=1 in the environment. */
export const trustProxy = () => process.env.TRUST_PROXY === "1";
