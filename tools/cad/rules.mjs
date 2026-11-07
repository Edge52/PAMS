// CAD reading rules (wave 16, 3D roadmap phase 2), pure: which layers hold walls, doors, glazing and columns, which
// layers hold room labels, and which block names are symbols worth keeping (equipment, sanitary fittings, gas outlets).
// The defaults read La Plaza's drawings; a building's config (floors.json) can add its own rules — they are tried first.
//
// Config shape (all optional):
//   "layers":  { "wall": ["…regex…"], "door": [], "glass": [], "column": [], "ignore": [], "roomText": [] }
//   "symbols": [ { "match": "…regex on the block name…", "kind": "equipment|sanitary|outlet|furniture", "code": "FUR-BED-…", "label": "Bed" } ]
// Regexes are case-insensitive and tested against the layer name after any xref prefix ("XREF$0$A-WALL" → "A-WALL").

const re = (s) => { try { return new RegExp(s, 'i'); } catch { return null; } };
const list = (a) => (Array.isArray(a) ? a.map(re).filter(Boolean) : []);

export const DEFAULT_LAYERS = {
  ignore: ['^PDF'],
  column: ['COLS|COLUMN'],
  glass: ['GLAZ|GLS|CURT|MULL'],
  door: ['DOOR|(^|-)DOR(-|$)'],
  // Walls and partitions, but not hatch patterns.
  wall: ['WALL?([-_]|$)(?!.*PAT)', 'partation|partition'],
  roomText: ['ROOMFINISH|[-_]ROOM$'],
};

/** A whole token: not part of a longer word or number (block names use _ and - as separators, so \\b won't do). */
const W = (s) => `(?<![A-Z0-9])(?:${s})(?![A-Z0-9])`;

/** Common block names in hospital drawings. Order matters: the first match wins. */
export const DEFAULT_SYMBOLS = [
  { match: W('O2') + '|OXYGEN', kind: 'outlet', code: 'GAS-O2', label: 'Oxygen outlet' },
  { match: W('VAC') + '|VACUUM|SUCTION', kind: 'outlet', code: 'GAS-VAC', label: 'Vacuum outlet' },
  { match: 'MED.?AIR|' + W('AIR4|MA4'), kind: 'outlet', code: 'GAS-AIR', label: 'Medical air outlet' },
  { match: 'AIR7|SURG.?AIR', kind: 'outlet', code: 'GAS-AIR7', label: 'Surgical air outlet' },
  { match: 'N2O|NITROUS|ENTONOX', kind: 'outlet', code: 'GAS-N2O', label: 'Nitrous oxide outlet' },
  { match: 'AGSS|SCAVENG', kind: 'outlet', code: 'GAS-AGSS', label: 'Anaesthetic gas scavenging' },
  { match: 'BED.?HEAD|BHU|PENDANT', kind: 'outlet', code: null, label: 'Bed-head unit or pendant' },
  { match: W('MRI'), kind: 'equipment', code: 'IMG-MRI', label: 'MRI scanner' },
  { match: W('CT') + '|CT.?SCAN', kind: 'equipment', code: 'IMG-CT', label: 'CT scanner' },
  { match: 'X.?RAY|RADIOGRAPH', kind: 'equipment', code: 'IMG-XR', label: 'X-ray unit' },
  { match: 'MAMMO', kind: 'equipment', code: 'IMG-MAM', label: 'Mammography unit' },
  { match: 'O\\.?R\\.?.?TABLE|OPERATING.?TABLE|OT.?TABLE', kind: 'equipment', code: 'SUR-OR-TABLE', label: 'Operating table' },
  { match: 'OT.?LIGHT|SURG.*LIGHT|OPERATING.?LIGHT', kind: 'equipment', code: 'SUR-OR-LIGHT', label: 'Operating light' },
  { match: 'INCUBATOR', kind: 'equipment', code: 'LIF-NEO-INC', label: 'Incubator' },
  { match: 'DENTAL.?CHAIR|DENTAL.?UNIT', kind: 'equipment', code: 'DEN-CHR', label: 'Dental chair' },
  { match: 'HOSP.*BED|PATIENT.?BED|ICU.?BED|' + W('BED'), kind: 'furniture', code: 'FUR-BED', label: 'Bed' },
  { match: 'STRETCHER|TROLLEY|GURNEY', kind: 'furniture', code: 'FUR-STR', label: 'Stretcher or trolley' },
  { match: 'EXAM.?COUCH|COUCH', kind: 'furniture', code: 'FUR-EXM', label: 'Examination couch' },
  { match: W('WC') + '|TOILET|WATER.?CLOSET', kind: 'sanitary', code: null, label: 'WC' },
  { match: 'BASIN|SINK|LAVATORY|' + W('LAV|WHB|HWB'), kind: 'sanitary', code: null, label: 'Basin or sink' },
  { match: 'SHOWER', kind: 'sanitary', code: null, label: 'Shower' },
  { match: 'SCRUB', kind: 'sanitary', code: null, label: 'Scrub sink' },
];

/** Readers built from a building's config: layer class, room-text layer, symbol for a block name. */
export function makeRules(cfg = {}) {
  const L = cfg.layers ?? {};
  const pick = (k) => [...list(L[k]), ...list(DEFAULT_LAYERS[k])];
  const R = { ignore: pick('ignore'), column: pick('column'), glass: pick('glass'), door: pick('door'), wall: pick('wall'), roomText: pick('roomText') };
  const symbols = [...(Array.isArray(cfg.symbols) ? cfg.symbols : []), ...DEFAULT_SYMBOLS]
    .map((s) => ({ ...s, re: re(s.match) })).filter((s) => s.re);
  const any = (rs, s) => rs.some((r) => r.test(s));
  return {
    /** "wall" | "door" | "glass" | "col" | null for a layer name. */
    layerClass(layer) {
      const n = layer ?? '';
      if (any(R.ignore, n)) return null;
      if (any(R.column, n)) return 'col';
      if (any(R.glass, n)) return 'glass';
      if (any(R.door, n)) return 'door';
      if (any(R.wall, n)) return 'wall';
      return null;
    },
    isRoomText(layer) { const n = layer ?? ''; return !any(R.ignore, n) && any(R.roomText, n); },
    /** The symbol a block stands for, or null. Room tags, title blocks and xrefs are never symbols. */
    symbolFor(blockName) {
      const n = (blockName ?? '').split('$0$').pop();
      if (!n || /^\*|room.?tag|title|xref|border|grid|north|section|level/i.test(n)) return null;
      const s = symbols.find((x) => x.re.test(n));
      return s ? { kind: s.kind, code: s.code ?? null, label: s.label ?? n } : null;
    },
  };
}

/**
 * Units check from dimensions: each linear dimension's stated measurement against the distance between its points.
 * Returns the median ratio (≈ 1 when the drawing's units are what the dimensions say) and how many were usable.
 */
export function dimensionScale(dims) {
  const r = dims.map((d) => { const len = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y); return d.measurement > 0 && len > 0 ? len / d.measurement : null; })
    .filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return { count: r.length, ratio: r.length ? r[Math.floor(r.length / 2)] : null };
}
