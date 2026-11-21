/**
 * Slowing down password guessing (wave 25; audit wave 30, S4). Pure and in memory, one table per server process.
 *
 * - Each attempt is counted when it starts (`reserve`), before the password is checked, and the wait it gets is
 *   booked against the key straight away. Requests sent in parallel therefore queue one behind the other instead
 *   of all skipping the delay. A right password clears the key.
 * - The table is capped. When full it drops expired entries first, then the oldest ones with the fewest failures
 *   (never fewer than needed), so filling it with junk emails can't wipe a key that is being delayed or blocked.
 */

export type ThrottleOptions = { windowMs: number; maxKeys: number; now?: () => number };
type Entry = { n: number; first: number; nextAt: number };

/** `refused`: the wait would be longer than allowed; nothing was booked, so others aren't pushed back further. */
export type Reservation = { wait: number; failures: number; refused: boolean };

export class Throttle {
  private readonly m = new Map<string, Entry>();
  constructor(private readonly o: ThrottleOptions) {}

  private now() { return this.o.now ? this.o.now() : Date.now(); }
  private live(key: string): Entry | undefined {
    const e = this.m.get(key);
    if (e && this.now() - e.first > this.o.windowMs && e.nextAt <= this.now()) { this.m.delete(key); return undefined; }
    return e;
  }

  get size() { return this.m.size; }

  /** Failures counted for this key in the current window. */
  failures(key: string): number { return this.live(key)?.n ?? 0; }

  /**
   * Count an attempt now and book its wait: `delayFor(failures before this one)` ms after the later of now and the
   * previous attempt's slot. Returns the wait and the failures before this attempt. A wait over `maxWait` is
   * refused (still counted, not booked), so a burst can't push the real owner's next try further than that.
   */
  reserve(key: string, delayFor: (failures: number) => number, maxWait = Infinity): Reservation {
    const now = this.now();
    let e = this.live(key);
    if (!e) { this.makeRoom(); e = { n: 0, first: now, nextAt: now }; this.m.set(key, e); }
    const before = e.n;
    e.n++;
    const at = Math.max(now, e.nextAt) + Math.max(0, delayFor(before));
    if (at - now > maxWait) return { wait: 0, failures: before, refused: true };
    e.nextAt = at;
    return { wait: at - now, failures: before, refused: false };
  }

  /** The attempt succeeded: forget the key. */
  clear(key: string): void { this.m.delete(key); }

  private makeRoom() {
    if (this.m.size < this.o.maxKeys) return;
    const now = this.now();
    for (const [k, e] of this.m) if (now - e.first > this.o.windowMs && e.nextAt <= now) this.m.delete(k);
    if (this.m.size < this.o.maxKeys) return;
    // Still full: drop about a tenth, oldest first among the entries with the fewest failures.
    const want = this.m.size - Math.floor(this.o.maxKeys * 0.9);
    const byFew = [...this.m.entries()].map(([k, e], i) => ({ k, n: e.n, i })).sort((a, b) => a.n - b.n || a.i - b.i);
    for (const x of byFew.slice(0, want)) this.m.delete(x.k);
  }
}

/** Account delay: free tries, then 1 s, 2 s, 4 s… up to 30 s. */
export const EMAIL_FREE = 5;
export function emailDelay(failures: number): number {
  const extra = failures - EMAIL_FREE;
  return extra < 0 ? 0 : Math.min(30_000, 1000 * 2 ** extra);
}
