// A small DXF reader (wave 16, 3D roadmap phase 2): ASCII DXF → the same shape the DWG reader (LibreDWG) returns, so
// extract.mjs reads both the same way. Covers what floor plans use: LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC, CIRCLE,
// TEXT, MTEXT, INSERT (with BLOCKS), DIMENSION. Angles come out in radians (DXF stores degrees). Pure; no I/O.

/** Group-code/value pairs from DXF text. */
function pairs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) { i -= 1; continue; } // resync on a stray line
    out.push([code, lines[i + 1]]);
  }
  return out;
}

const RAD = Math.PI / 180;
const num = (v, d = 0) => { const n = Number(String(v).trim()); return Number.isFinite(n) ? n : d; };

/** Entities between `from` and the next ENDSEC/ENDBLK, grouped by their 0 code. */
function entityGroups(ps, from, stop) {
  const groups = []; let cur = null; let i = from;
  for (; i < ps.length; i++) {
    const [c, v] = ps[i]; const t = v.trim();
    if (c === 0) {
      if (stop.includes(t)) break;
      cur = { type: t, codes: [] }; groups.push(cur);
    } else if (cur) cur.codes.push([c, v]);
  }
  return { groups, end: i };
}

function toEntity(g) {
  const get = (c, d) => { const p = g.codes.find((x) => x[0] === c); return p ? p[1] : d; };
  const all = (c) => g.codes.filter((x) => x[0] === c).map((x) => x[1]);
  const pt = (cx, cy) => ({ x: num(get(cx, 0)), y: num(get(cy, 0)) });
  const e = { type: g.type, layer: String(get(8, '0')).trim() };
  switch (g.type) {
    case 'LINE': e.startPoint = pt(10, 20); e.endPoint = pt(11, 21); break;
    case 'LWPOLYLINE': {
      const xs = all(10), ys = all(20);
      e.vertices = xs.map((x, k) => ({ x: num(x), y: num(ys[k]) }));
      e.flag = num(get(70, 0)); break;
    }
    case 'ARC': e.center = pt(10, 20); e.radius = num(get(40, 0)); e.startAngle = num(get(50, 0)) * RAD; e.endAngle = num(get(51, 0)) * RAD; break;
    case 'CIRCLE': e.center = pt(10, 20); e.radius = num(get(40, 0)); break;
    case 'TEXT': e.text = { text: String(get(1, '')), startPoint: pt(10, 20) }; e.startPoint = pt(10, 20); break;
    case 'MTEXT': e.text = [...all(3), get(1, '')].join(''); e.insertionPoint = pt(10, 20); break;
    case 'INSERT': e.name = String(get(2, '')).trim(); e.insertionPoint = pt(10, 20); e.xScale = num(get(41, 1), 1); e.yScale = num(get(42, 1), 1); e.rotation = num(get(50, 0)) * RAD; break;
    case 'DIMENSION': {
      e.text = String(get(1, '')); e.measurement = g.codes.some((x) => x[0] === 42) ? num(get(42)) : undefined;
      e.subDefinitionPoint1 = pt(13, 23); e.subDefinitionPoint2 = pt(14, 24); e.definitionPoint = pt(10, 20); e.dimensionType = num(get(70, 0)) & 7;
      break;
    }
    default: break;
  }
  return e;
}

/** Old-style POLYLINE: the VERTEX entities after it, up to SEQEND, become its vertices. */
function joinPolylines(groups) {
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.type !== 'POLYLINE') { if (g.type !== 'VERTEX' && g.type !== 'SEQEND') out.push(toEntity(g)); continue; }
    const p = { type: 'POLYLINE2D', layer: String((g.codes.find((x) => x[0] === 8) ?? [8, '0'])[1]).trim(), flag: num((g.codes.find((x) => x[0] === 70) ?? [70, 0])[1]), vertices: [] };
    let j = i + 1;
    for (; j < groups.length && groups[j].type === 'VERTEX'; j++) {
      const v = groups[j].codes; const f = (c) => num((v.find((x) => x[0] === c) ?? [c, 0])[1]);
      p.vertices.push({ x: f(10), y: f(20) });
    }
    if (groups[j]?.type === 'SEQEND') i = j; else i = j - 1;
    out.push(p);
  }
  return out;
}

/** Read DXF text into { entities, tables: { BLOCK_RECORD: { entries: [{ name, basePoint, entities }] } }, units }. */
export function readDxf(text) {
  const ps = pairs(text);
  const blocks = []; let entities = []; let insunits = null;
  for (let i = 0; i < ps.length; i++) {
    const [c, v] = ps[i];
    if (c === 9 && v.trim() === '$INSUNITS') { const n = ps[i + 1]; if (n && n[0] === 70) insunits = num(n[1]); }
    if (c !== 2 || i === 0 || ps[i - 1][0] !== 0 || ps[i - 1][1].trim() !== 'SECTION') continue;
    const name = v.trim();
    if (name === 'ENTITIES') {
      const { groups, end } = entityGroups(ps, i + 1, ['ENDSEC']);
      entities = joinPolylines(groups); i = end;
    } else if (name === 'BLOCKS') {
      let k = i + 1;
      while (k < ps.length && !(ps[k][0] === 0 && ps[k][1].trim() === 'ENDSEC')) {
        if (ps[k][0] === 0 && ps[k][1].trim() === 'BLOCK') {
          // Block header codes until the first entity.
          let h = k + 1; const head = [];
          for (; h < ps.length && ps[h][0] !== 0; h++) head.push(ps[h]);
          const hv = (c, d) => { const p = head.find((x) => x[0] === c); return p ? p[1] : d; };
          const { groups, end } = entityGroups(ps, h, ['ENDBLK']);
          blocks.push({ name: String(hv(2, '')).trim(), basePoint: { x: num(hv(10, 0)), y: num(hv(20, 0)) }, entities: joinPolylines(groups) });
          k = end + 1;
        } else k++;
      }
      i = k;
    }
  }
  // $INSUNITS: 4 = millimetres, 5 = centimetres, 6 = metres, 1 = inches, 2 = feet; null when the file doesn't say.
  const units = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' }[insunits] ?? null;
  return { entities, tables: { BLOCK_RECORD: { entries: blocks } }, units };
}

/** Millimetres per drawing unit for a DXF's $INSUNITS (null = not stated; the pipeline assumes millimetres). */
export const MM_PER_UNIT = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
