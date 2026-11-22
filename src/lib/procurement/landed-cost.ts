/**
 * Landed cost by Incoterm (wave 37, audit "missing features" 7). Pure — no database, one currency (the offer's).
 *
 * Offers quoted on different Incoterms aren't comparable on price alone: an EXW price leaves freight, insurance,
 * customs and delivery to the hospital, a DDP price includes them. The landed cost adds what the hospital still pays
 * on top of the price under the offer's term, so every offer is compared as if delivered duty paid (DDP).
 *
 * Each cost the buyer bears under the term is taken from the offer when stated there, else from the hospital's
 * default (a % of the net price, set under Approval rules & settings):
 *   freight and insurance — EXW, FCA, FOB (insurance also CFR, CPT);
 *   customs duty — every term except DDP, as a % of the CIF value (net price + freight + insurance);
 *   clearance — every term except DDP;
 *   local delivery to the hospital — every term except DAP, DPU and DDP.
 * An offer without an Incoterm gets only the costs typed on the offer (no defaults), and is flagged.
 */
import type { Incoterm } from "./labels";

export type CostPart = "freight" | "insurance" | "duty" | "clearance" | "localDelivery";
export const COST_PARTS: CostPart[] = ["freight", "insurance", "duty", "clearance", "localDelivery"];
export const COST_LABELS: Record<CostPart, string> = {
  freight: "Freight", insurance: "Insurance", duty: "Customs and duty", clearance: "Clearance", localDelivery: "Local delivery",
};

/** Costs the hospital still pays on top of the price, by term. */
export const BUYER_PAYS: Record<Incoterm, CostPart[]> = {
  EXW: ["freight", "insurance", "duty", "clearance", "localDelivery"],
  FCA: ["freight", "insurance", "duty", "clearance", "localDelivery"],
  FOB: ["freight", "insurance", "duty", "clearance", "localDelivery"],
  CFR: ["insurance", "duty", "clearance", "localDelivery"],
  CPT: ["insurance", "duty", "clearance", "localDelivery"],
  CIF: ["duty", "clearance", "localDelivery"],
  CIP: ["duty", "clearance", "localDelivery"],
  DAP: ["duty", "clearance"],
  DPU: ["duty", "clearance"],
  DDP: [],
};

/** Hospital defaults, each a % of the net price (duty: % of the CIF value). */
export type LandedDefaults = { freightPct: number; insurancePct: number; dutyPct: number; clearancePct: number; localDeliveryPct: number };

/** What the offer states: amounts in the offer currency, duty as a %. null/undefined = not stated. */
export type LandedStated = { freight?: number | null; insurance?: number | null; dutyPct?: number | null; clearance?: number | null; localDelivery?: number | null };

export type LandedPart = { part: CostPart; amount: number; source: "offer" | "default"; note: string };
export type LandedResult = {
  incoterm: Incoterm | null;
  net: number;
  parts: LandedPart[];
  /** Sum of the parts. */
  extra: number;
  landed: number;
  /** landed ÷ net (1 when net is 0). Multiply a net price by it to get its landed equivalent. */
  factor: number;
  /** No Incoterm on the offer: only costs typed on the offer were added. */
  termMissing: boolean;
  /** Stated costs the term already includes, so they were not added (e.g. freight on a CIF offer). */
  ignored: CostPart[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const given = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v >= 0;

export function landedCost(incoterm: Incoterm | null | undefined, net: number, stated: LandedStated, defaults: LandedDefaults): LandedResult {
  const term = incoterm ?? null;
  const pays = new Set<CostPart>(term ? BUYER_PAYS[term] : COST_PARTS);
  const useDefaults = term != null;
  const parts: LandedPart[] = [];
  const amountOf = (part: Exclude<CostPart, "duty">, statedValue: number | null | undefined, pct: number) => {
    if (!pays.has(part)) return 0;
    if (given(statedValue)) { parts.push({ part, amount: r2(statedValue), source: "offer", note: "stated on the offer" }); return statedValue; }
    if (!useDefaults || !(pct > 0)) return 0;
    const a = r2((net * pct) / 100);
    parts.push({ part, amount: a, source: "default", note: `default ${pct} % of the price` });
    return a;
  };
  const freight = amountOf("freight", stated.freight, defaults.freightPct);
  const insurance = amountOf("insurance", stated.insurance, defaults.insurancePct);
  if (pays.has("duty")) {
    const pct = given(stated.dutyPct) ? stated.dutyPct : useDefaults ? defaults.dutyPct : 0;
    if (pct > 0) {
      const basis = net + freight + insurance;
      parts.push({ part: "duty", amount: r2((basis * pct) / 100), source: given(stated.dutyPct) ? "offer" : "default", note: `${pct} % of ${r2(basis).toFixed(2)} (price${freight || insurance ? " + freight + insurance" : ""})` });
    }
  }
  amountOf("clearance", stated.clearance, defaults.clearancePct);
  amountOf("localDelivery", stated.localDelivery, defaults.localDeliveryPct);
  // Order the parts as COST_PARTS for display.
  parts.sort((a, b) => COST_PARTS.indexOf(a.part) - COST_PARTS.indexOf(b.part));
  const statedMap: Record<CostPart, number | null | undefined> = { freight: stated.freight, insurance: stated.insurance, duty: stated.dutyPct, clearance: stated.clearance, localDelivery: stated.localDelivery };
  const ignored = COST_PARTS.filter((p) => !pays.has(p) && given(statedMap[p]) && statedMap[p]! > 0);
  const extra = r2(parts.reduce((s, p) => s + p.amount, 0));
  const landed = r2(net + extra);
  return { incoterm: term, net, parts, extra, landed, factor: net > 0 ? landed / net : 1, termMissing: term == null, ignored };
}

/** "Rank prices by" setting: net price (default, the scoring used so far) or landed cost. */
export type PriceBasis = "NET" | "LANDED";
export const PRICE_BASIS_LABELS: Record<PriceBasis, string> = { NET: "Net price", LANDED: "Landed cost (DDP equivalent)" };
/** The same in a sentence ("Ranked by …"). */
export const PRICE_BASIS_PHRASE: Record<PriceBasis, string> = { NET: "net price", LANDED: "landed cost (DDP equivalent)" };
