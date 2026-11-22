import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readDxf } from './dxf.mjs';
import { dimensionScale, makeRules } from './rules.mjs';
import { sampleFloor } from './sample/make-sample.mjs';

describe('CAD reading (wave 16)', () => {
  it('reads a DXF into the DWG reader\'s shape', () => {
    const db = readDxf(sampleFloor('GR'));
    expect(db.units).toBe('mm');
    expect(db.tables.BLOCK_RECORD.entries.map((b) => b.name)).toEqual(['HOSPITAL_BED', 'MG_O2_OUTLET', 'WHB-600', 'CHAIR-VISITOR']);
    const walls = db.entities.filter((e) => e.type === 'LINE' && e.layer === 'A-WALL');
    expect(walls.length).toBe(8);
    const bed = db.entities.find((e) => e.type === 'INSERT' && e.rotation > 0);
    expect(bed).toMatchObject({ name: 'HOSPITAL_BED', insertionPoint: { x: 7000, y: 8000 } });
    expect(bed.rotation).toBeCloseTo(Math.PI / 2);
    const dim = db.entities.find((e) => e.type === 'DIMENSION');
    expect(dim).toMatchObject({ text: '6000', subDefinitionPoint2: { x: 6000, y: 6000 } });
  });
  it('classifies layers, with a building\'s own rules first', () => {
    const r = makeRules({ layers: { wall: ['^MY-PARTS$'], ignore: ['^OLD-'] } });
    expect(r.layerClass('A-WALL')).toBe('wall');
    expect(r.layerClass('MY-PARTS')).toBe('wall');
    expect(r.layerClass('A-WALL-PATT')).toBe(null);
    expect(r.layerClass('OLD-A-WALL')).toBe(null);
    expect(r.layerClass('PDF_A-WALL')).toBe(null);
    expect(r.layerClass('A-GLAZ')).toBe('glass');
    expect(r.layerClass('S-COLS')).toBe('col');
    expect(r.layerClass('A-DOOR')).toBe('door');
    expect(r.isRoomText('A-ROOM')).toBe(true);
  });
  it('recognises symbols by block name, without false friends', () => {
    const r = makeRules({ symbols: [{ match: 'CHAIR', kind: 'furniture', label: 'Chair' }] });
    expect(r.symbolFor('MG_O2_OUTLET')).toMatchObject({ kind: 'outlet', code: 'GAS-O2' });
    expect(r.symbolFor('CO2-EXTINGUISHER')).toBe(null);
    expect(r.symbolFor('HOSPITAL_BED')).toMatchObject({ code: 'FUR-BED' });
    expect(r.symbolFor('BEDSIDE-LOCKER')).toBe(null);
    expect(r.symbolFor('XREF$0$CT-GANTRY')).toMatchObject({ code: 'IMG-CT' });
    expect(r.symbolFor('WHB-600')).toMatchObject({ kind: 'sanitary' });
    expect(r.symbolFor('CHAIR-VISITOR')).toMatchObject({ label: 'Chair' });
    expect(r.symbolFor('Room Tag - Name')).toBe(null);
  });
  it('checks units from dimensions', () => {
    expect(dimensionScale([{ measurement: 6000, p1: { x: 0, y: 0 }, p2: { x: 6000, y: 0 } }])).toEqual({ count: 1, ratio: 1 });
    expect(dimensionScale([{ measurement: 6, p1: { x: 0, y: 0 }, p2: { x: 6000, y: 0 } }, { measurement: 3, p1: { x: 0, y: 0 }, p2: { x: 0, y: 3000 } }]).ratio).toBe(1000);
    expect(dimensionScale([])).toEqual({ count: 0, ratio: null });
  });
});

describe('CAD import fails clearly (A15)', () => {
  const extract = fileURLToPath(new URL('./extract.mjs', import.meta.url));
  const run = (dxf) => {
    const dir = mkdtempSync(join(tmpdir(), 'cad-a15-'));
    writeFileSync(join(dir, 'floor.dxf'), dxf);
    const r = spawnSync(process.execPath, [extract, join(dir, 'floor.dxf'), join(dir, 'out.json')], { encoding: 'utf8' });
    return { ...r, dir };
  };
  it('stops with a reason when a floor has no wall lines', () => {
    const empty = sampleFloor('GR').replace(/\nA-WALL\n/g, '\nA-NOTES\n');
    const r = run(empty);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no wall lines found/);
  });
  it('still extracts a normal floor', () => {
    const r = run(sampleFloor('GR'));
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(join(r.dir, 'out.json'), 'utf8')).segs.wall.length).toBeGreaterThan(0);
  });
});
