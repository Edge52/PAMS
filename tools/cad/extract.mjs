// Extract one floor: wall/door/column/glazing segments (mm), room tags with name/number, zone labels.
import { readFileSync, writeFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const [, , file, out] = process.argv;
const lib = await LibreDwg.create(new URL('../../node_modules/@mlightcad/libredwg-web/wasm/', import.meta.url).pathname);
const data = lib.dwg_read_data(readFileSync(file), Dwg_File_Type.DWG);
const db = lib.convert(data);
const base = (l) => (l || '').split('$0$').pop();
// ── Explode block references (bound xrefs, door families, curtain walls) into world coordinates. ──
const blocks = new Map((db.tables?.BLOCK_RECORD?.entries ?? []).map((r) => [r.name, r]));
function xf(ins, rec) {
  const bp = rec?.basePoint ?? { x: 0, y: 0 };
  const sx = ins.xScale ?? 1, sy = ins.yScale ?? 1, r = ins.rotation ?? 0, c = Math.cos(r), sn = Math.sin(r);
  const ip = ins.insertionPoint ?? { x: 0, y: 0 };
  return (p) => { const x = (p.x - bp.x) * sx, y = (p.y - bp.y) * sy; return { x: ip.x + x * c - y * sn, y: ip.y + x * sn + y * c }; };
}
const ident = (p) => p;
const flat = [];
const WANT = (L, e) => /TEXT/.test(e.type) || cls0(L) != null || e.type === 'INSERT';
function walk(list, T, parentLayer, depth, rot) {
  for (const e of list) {
    const L = (e.layer === '0' || !e.layer) && parentLayer ? parentLayer : base(e.layer);
    if (e.type === 'INSERT') {
      if (/Room Tag/i.test(e.name)) flat.push({ ...e, layer: L, insertionPoint: T(e.insertionPoint) });
      const rec = blocks.get(e.name);
      if (rec?.entities?.length && depth < 5) {
        const inner = xf(e, rec);
        walk(rec.entities, (p) => T(inner(p)), L, depth + 1, rot + (e.rotation ?? 0));
      }
      continue;
    }
    if (!WANT(L, e)) continue;
    const o = { type: e.type, layer: L };
    if (e.startPoint) o.startPoint = T(e.startPoint);
    if (e.endPoint) o.endPoint = T(e.endPoint);
    if (e.insertionPoint) o.insertionPoint = T(e.insertionPoint);
    if (e.vertices) o.vertices = e.vertices.map(T);
    if (e.flag != null) o.flag = e.flag;
    if (e.center) { o.center = T(e.center); o.radius = e.radius * Math.abs(T === ident ? 1 : Math.hypot(T({ x: 1, y: 0 }).x - T({ x: 0, y: 0 }).x, T({ x: 1, y: 0 }).y - T({ x: 0, y: 0 }).y)); o.startAngle = (e.startAngle ?? 0) + rot; o.endAngle = (e.endAngle ?? 0) + rot; }
    if (e.text !== undefined) o.text = typeof e.text === 'string' ? e.text : { ...e.text, startPoint: e.text?.startPoint ? T(e.text.startPoint) : undefined };
    if (e.contents !== undefined) o.contents = e.contents;
    flat.push(o);
  }
}

// Layer naming differs between the floors' templates (A-WALL, I-WALL, A-200-M_WALL_INT…); PDF* layers are reference overlays.
const cls0 = (L) => /^PDF/i.test(L) ? null : /COLS|COLUMN/i.test(L) ? 'col' : /GLAZ|GLS|CURT|MULL/i.test(L) ? 'glass' : /DOOR|(^|-)DOR(-|$)/i.test(L) ? 'door'
  : ((/WALL?([-_]|$)/i.test(L) && !/PAT/i.test(L)) || /partation|partition/i.test(L)) ? 'wall' : null;
const cls = cls0;
walk(db.entities, ident, null, 0, 0);
const ENTS = flat;
const ROOM_TEXT = (L) => !/^PDF/i.test(L) && /ROOMFINISH|[-_]ROOM$/i.test(L);
const segs = { wall: [], door: [], col: [], glass: [] };
const push = (k, a, b) => segs[k].push([Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)]);
function arcPts(c, r, a0, a1, n = 8) { const pts = []; if (a1 < a0) a1 += Math.PI * 2; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); } return pts; }
for (const e of ENTS) {
  const k = cls(base(e.layer)); if (!k) continue;
  if (e.type === 'LINE') push(k, e.startPoint, e.endPoint);
  else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE2D') {
    const v = e.vertices ?? []; for (let i = 0; i + 1 < v.length; i++) push(k, v[i], v[i + 1]);
    if ((e.flag & 1) && v.length > 2) push(k, v[v.length - 1], v[0]);
  } else if (e.type === 'ARC') { const p = arcPts(e.center, e.radius, e.startAngle, e.endAngle); for (let i = 0; i + 1 < p.length; i++) push(k, p[i], p[i + 1]); }
  else if (e.type === 'CIRCLE' && k === 'col') { const p = arcPts(e.center, e.radius, 0, Math.PI * 2, 12); for (let i = 0; i + 1 < p.length; i++) push(k, p[i], p[i + 1]); }
}
const txt = (e) => (typeof e.text === 'string' ? e.text : e.text?.text ?? e.contents ?? '').replace(/\\P/g, ' ').replace(/\{\\[^;]*;|[{}]/g, '').trim();
const pos = (e) => e.insertionPoint ?? e.text?.startPoint ?? e.startPoint;
const roomTexts = [];
for (const e of ENTS) {
  if (!/TEXT/.test(e.type) || !ROOM_TEXT(base(e.layer))) continue;
  const t = txt(e), p = pos(e); if (t && p && t !== 'LP') roomTexts.push({ t, x: p.x, y: p.y });
}
// Anchors: Room Tag blocks when present at top level; otherwise each tag's floor-code text (one per room).
let tags = ENTS.filter((e) => e.type === 'INSERT' && /Room Tag/i.test(e.name)).map((t) => ({ x: t.insertionPoint.x, y: t.insertionPoint.y, parts: [] }));
// The floor code is the token every room tag repeats (GR, GAR, BS1, 01…): the most frequent short token.
const freq = {}; for (const r of roomTexts) if (/^[A-Z0-9]{2,4}$/.test(r.t)) freq[r.t] = (freq[r.t] || 0) + 1;
const marker = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
if (tags.length < roomTexts.filter((r) => r.t === marker).length * 0.8) tags = roomTexts.filter((r) => r.t === marker).map((r) => ({ x: r.x, y: r.y, parts: [] }));
for (const r of roomTexts) {
  let best = null, bd = 1300; for (const g of tags) { const d = Math.hypot(g.x - r.x, g.y - r.y); if (d < bd) { bd = d; best = g; } }
  if (best) best.parts.push({ t: r.t });
}
const rooms = tags.map((g) => {
  const ps = g.parts.map((p) => p.t);
  const flr = ps.find((t) => t === marker);
  const num = ps.find((t) => /^\d{1,4}[A-Z]?$/.test(t) && t !== flr);
  const dept = ps.find((t) => /^[A-Z][A-Z0-9/&]{1,6}$/.test(t) && t !== flr && t !== num && !/^(TLT|WC|LP)$/.test(t));
  const name = ps.filter((t) => t !== num && t !== flr && t !== dept).sort((a, b) => b.length - a.length)[0] ?? '';
  return { x: Math.round(g.x), y: Math.round(g.y), floor: flr ?? marker, dept: dept ?? null, num: num ?? null, name, raw: ps };
}).filter((r) => r.num || r.name);
const zones = ENTS.filter((e) => /TEXT/.test(e.type) && base(e.layer) === 'G-ANNO-TEXT').map((e) => ({ t: txt(e), x: Math.round(pos(e).x), y: Math.round(pos(e).y) })).filter((z) => z.t);
// Lift labels on any layer: vertical shafts, used to align the floors with each other.
const lifts = {};
for (const e of ENTS) {
  if (!/TEXT/.test(e.type) || /^PDF/i.test(base(e.layer))) continue;
  const m = /^Elevator\s*-\s*(\d+)$/i.exec(txt(e)); const p = pos(e);
  if (m && p) (lifts[m[1]] ??= []).push([Math.round(p.x), Math.round(p.y)]);
}
writeFileSync(out, JSON.stringify({ file: file.split('/').pop(), units: 'mm', marker, segs, rooms, zones, lifts }));
console.log(file.split('/').pop(), 'marker', marker, 'walls', segs.wall.length, 'doors', segs.door.length, 'cols', segs.col.length, 'glass', segs.glass.length, 'lifts', Object.keys(lifts).length, 'rooms', rooms.length,
  'named', rooms.filter((r) => r.name).length, 'numbered', rooms.filter((r) => r.num).length);
lib.dwg_free(data);
