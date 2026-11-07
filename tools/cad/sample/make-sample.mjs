// A small two-floor sample in DXF (wave 16): walls with door gaps, room tags, lift labels, symbol blocks (beds, an
// oxygen outlet, a basin), a block no rule knows, and a dimension typed over. Used by the tests and to try the pipeline
// without real drawings:  node tools/cad/sample/make-sample.mjs <out dir>
import { mkdirSync, writeFileSync } from 'node:fs';

const L = (...pairs) => pairs.map(([c, v]) => `${c}\n${v}`).join('\n');
const line = (layer, x1, y1, x2, y2) => L([0, 'LINE'], [8, layer], [10, x1], [20, y1], [11, x2], [21, y2]);
const text = (layer, x, y, t) => L([0, 'TEXT'], [8, layer], [10, x], [20, y], [40, 200], [1, t]);
const insert = (name, x, y, rot = 0, layer = 'A-FURN') => L([0, 'INSERT'], [8, layer], [2, name], [10, x], [20, y], [41, 1], [42, 1], [50, rot]);
const block = (name, body) => L([0, 'BLOCK'], [8, '0'], [2, name], [70, 0], [10, 0], [20, 0]) + '\n' + body + '\n' + L([0, 'ENDBLK']);
const box = (layer, x, y, w, h) => [line(layer, x, y, x + w, y), line(layer, x + w, y, x + w, y + h), line(layer, x + w, y + h, x, y + h), line(layer, x, y + h, x, y)].join('\n');

/** One floor: a 20 × 10 m plan with two rooms off a corridor, lifts at the corners. Millimetres. */
export function sampleFloor(code, { shift = [0, 0], dimText = '6000' } = {}) {
  const [dx, dy] = shift; const X = (x) => x + dx, Y = (y) => y + dy;
  const ents = [];
  // Outer walls and the corridor wall, with 1 m door gaps into each room.
  ents.push(box('A-WALL', X(0), Y(0), 20000, 10000));
  ents.push(line('A-WALL', X(0), Y(6000), X(4000), Y(6000)), line('A-WALL', X(5000), Y(6000), X(14000), Y(6000)), line('A-WALL', X(15000), Y(6000), X(20000), Y(6000)));
  ents.push(line('A-WALL', X(10000), Y(6000), X(10000), Y(10000)));
  ents.push(line('A-DOOR', X(4000), Y(6000), X(5000), Y(6100)), line('A-DOOR', X(14000), Y(6000), X(15000), Y(6100)));
  // Room tags: floor code, department, number, name.
  const tag = (x, y, dept, num, name) => [text('A-ROOM', X(x), Y(y), code), text('A-ROOM', X(x), Y(y - 250), dept), text('A-ROOM', X(x), Y(y - 500), num), text('A-ROOM', X(x), Y(y - 750), name)].join('\n');
  ents.push(tag(4000, 8500, 'WRD', '01', 'Patient Room'), tag(14000, 8500, 'WRD', '02', 'Treatment Room'), tag(9000, 3500, 'WRD', '03', 'Corridor'));
  // Lift labels (to align the floors).
  ents.push(text('G-ANNO', X(500), Y(500), 'Elevator - 1'), text('G-ANNO', X(19000), Y(500), 'Elevator - 2'), text('G-ANNO', X(19000), Y(9500), 'Elevator - 3'));
  // Symbols: two beds, an oxygen outlet, a basin; a chair block no rule knows.
  ents.push(insert('HOSPITAL_BED', X(2500), Y(8000)), insert('HOSPITAL_BED', X(7000), Y(8000), 90), insert('MG_O2_OUTLET', X(2500), Y(9800)), insert('WHB-600', X(17000), Y(9500)), insert('CHAIR-VISITOR', X(12000), Y(7000)));
  // A dimension across the first room: 6000 typed, 6 m apart in the drawing.
  ents.push(L([0, 'DIMENSION'], [8, 'A-DIMS'], [1, dimText], [10, X(0)], [20, Y(9000)], [13, X(0)], [23, Y(6000)], [14, X(6000)], [24, Y(6000)], [70, 1]));
  const blocks = [
    block('HOSPITAL_BED', box('0', -500, -1050, 1000, 2100)),
    block('MG_O2_OUTLET', box('0', -50, -50, 100, 100)),
    block('WHB-600', box('0', -300, -225, 600, 450)),
    block('CHAIR-VISITOR', box('0', -250, -250, 500, 500)),
  ];
  return [L([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC']), L([0, 'SECTION'], [2, 'BLOCKS']), ...blocks, L([0, 'ENDSEC']),
    L([0, 'SECTION'], [2, 'ENTITIES']), ...ents, L([0, 'ENDSEC'], [0, 'EOF'])].join('\n') + '\n';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dir = process.argv[2] ?? '.';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/GR.dxf`, sampleFloor('GR'));
  writeFileSync(`${dir}/F1.dxf`, sampleFloor('F1', { shift: [3000, -2000] }));
  writeFileSync(`${dir}/sample.json`, JSON.stringify({ building: 'Sample Hospital', facilityCode: 'SMP', output: 'tmp/sample-building.json', floorToFloorMetres: 4.5, referenceFloor: 'GR',
    floors: [{ code: 'GR', name: 'Ground floor', level: 0, file: 'GR.dxf' }, { code: 'F1', name: 'First floor', level: 1, file: 'F1.dxf' }],
    symbols: [{ match: 'CHAIR', kind: 'furniture', code: null, label: 'Chair' }] }, null, 2));
  console.log('Sample written to', dir);
}
