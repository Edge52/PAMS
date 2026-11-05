/// <reference lib="webworker" />
/** Runs the queue simulation off the main thread (wave 14, B3): the baseline, then the what-if when there is one. */
import { simulate, type SimModel, type SimOptions } from "./simulate";

export type SimRequest = { model: SimModel; base: Partial<SimOptions>; whatIf: Partial<SimOptions> | null };
export type SimReply = { kind: "progress"; done: number; of: number } | { kind: "done"; base: ReturnType<typeof simulate>; whatIf: ReturnType<typeof simulate> | null } | { kind: "error"; message: string };

const post = (m: SimReply) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<SimRequest>) => {
  try {
    const { model, base, whatIf } = e.data;
    const of = (base.runs ?? 20) * (whatIf ? 2 : 1);
    let done = 0;
    const tick = () => { done++; if (done % 2 === 0 || done === of) post({ kind: "progress", done, of }); };
    const b = simulate(model, base, tick);
    const w = whatIf ? simulate(model, whatIf, tick) : null;
    post({ kind: "done", base: b, whatIf: w });
  } catch (err) {
    post({ kind: "error", message: (err as Error).message || "The simulation stopped." });
  }
};
