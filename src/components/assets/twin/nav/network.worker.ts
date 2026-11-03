/// <reference lib="webworker" />
/**
 * Builds a floor's walking network off the main thread (wave 12, A6), so the 3D view stays smooth while a large floor
 * is analysed. Same code as on the main thread and the server; the grids come back as transferred buffers.
 */
import { buildNetwork, type NavRoom, type RouteFix } from "./network";

type Job = { id: number; floorId: number; segs: number[]; rooms: NavRoom[]; opts: { fixes?: RouteFix[] } };

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, floorId, segs, rooms, opts } = e.data;
  try {
    const net = buildNetwork(floorId, segs, rooms, opts);
    (self as unknown as Worker).postMessage({ id, net }, [net.free.buffer, net.comp.buffer, net.zone.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
