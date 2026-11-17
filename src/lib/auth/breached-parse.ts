/** Reads the password service's answer: lines "HASH_SUFFIX:COUNT". Padding lines have count 0. Pure. */
export function breachCount(body: string, suffix: string): number {
  const want = suffix.toUpperCase();
  for (const line of body.split(/\r?\n/)) {
    const [h, c] = line.trim().split(":");
    if (h?.toUpperCase() === want) return Number(c) || 0;
  }
  return 0;
}
