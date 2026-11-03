"use client";
/**
 * Network building in a Web Worker (wave 12, A6). One worker per page, started on first use; if workers aren't
 * available or the worker fails, the network is built on the main thread as before.
 */
import { buildNetwork, type Network, type NavRoom, type RouteFix } from "./network";

export type NetworkBuilder = (floorId: number, segs: number[], rooms: NavRoom[], opts: { fixes?: RouteFix[] }) => Promise<Network>;

export function workerBuilder(): NetworkBuilder | undefined {
  if (typeof window === "undefined" || typeof Worker === "undefined") return undefined;
  let worker: Worker | null = null, broken = false, seq = 0;
  const waiting = new Map<number, { ok: (n: Network) => void; fail: (e: Error) => void }>();
  const start = () => {
    if (worker || broken) return worker;
    try {
      worker = new Worker(new URL("./network.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<{ id: number; net?: Network; error?: string }>) => {
        const w = waiting.get(e.data.id); if (!w) return;
        waiting.delete(e.data.id);
        if (e.data.net) w.ok(e.data.net); else w.fail(new Error(e.data.error ?? "Network build failed"));
      };
      worker.onerror = () => { broken = true; worker?.terminate(); worker = null; for (const w of waiting.values()) w.fail(new Error("worker failed")); waiting.clear(); };
    } catch { broken = true; worker = null; }
    return worker;
  };
  return (floorId, segs, rooms, opts) => {
    const w = start();
    if (!w) return Promise.resolve(buildNetwork(floorId, segs, rooms, opts));
    const id = ++seq;
    return new Promise<Network>((ok, fail) => { waiting.set(id, { ok, fail }); w.postMessage({ id, floorId, segs, rooms, opts }); })
      .catch(() => buildNetwork(floorId, segs, rooms, opts));
  };
}
