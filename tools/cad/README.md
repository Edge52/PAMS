# CAD import: DWG floor plans → 3D model and rooms

Turns a set of DWG floor plans (one file per floor) into:

- the hospital as a facility in the system: floors, departments, rooms with their **real outlines**, beds;
- the 3D model (walls, doors, glazing and columns per floor) shown under **Assets › 3D view**;
- an illustrative equipment fit-out derived from room names (marked as demo data; replace with the real register).

## Run it

```bash
pip install numpy scipy opencv-python-headless shapely pillow      # once
npm run cad:import -- ~/Desktop/HS/hospital-pams/CAD                 # → seed-data/cad/la-plaza.json (≈ 15 min)
npm run db:seed                                                      # or npm run demo: loads new buildings
```

To re-import revised drawings of a building already loaded, delete that facility first (its code is in
`floors.json`) or change `facilityCode`, then seed again.

## The config: `floors.json`

Which file is which floor, its level (0 = the floor at the main entrance level; basements negative), the
floor-to-floor height, and the reference floor used for alignment. For another hospital, copy the file, edit it and
pass it as the second argument: `npm run cad:import -- <folder> tools/cad/other-hospital.json`.

## How it works

1. **`extract.mjs`** reads each DWG with LibreDWG (WebAssembly build, `@mlightcad/libredwg-web`, GPL-3.0; used only
   as this offline tool, not shipped in the app). Block references are exploded recursively, so plans bound in as
   xrefs, door families and curtain walls are included. Layers are classified by name (`*WALL*`, `*DOOR*`,
   `*GLAZ*`/`*CURT*`/`*MULL*`, `*COL*`; `PDF*` overlays ignored). Room labels come from the room-tag text
   (`floor | department | number | name`, e.g. `GR | OUT | 02 | Dental exam room (1)`), anchored on the floor code
   every tag repeats. Lift labels ("Elevator - N") are kept for alignment.
2. **`rooms.py`** finds each room's outline by flood-filling the walled space around its label. Doors are often
   separate objects, so doorways are bridged with increasing tolerance (0, 0.9, 1.3, 1.8 m) and each room takes the
   smallest that encloses it alone; open areas shared by several labels are split between them.
3. **`build.py`** aligns all floors to the reference floor with a rigid fit on the lift labels (consensus over pairs,
   so repeated labels in key plans are ignored), clips stray geometry outside the building, and writes one JSON in
   plan units of 100 mm.
4. **`scripts/seed/cad.ts`** loads that JSON: departments from the drawing's department codes, room types and beds
   from room names, and the demo fit-out. Both mappings are tables at the top of that file; extend them for new codes.

`render.py` draws a floor's extraction to a PNG (`python3 render.py <code>.json out.png`), useful when a new drawing
set uses different layer names.

## La Plaza results (October 2026 drawings)

| Floor | Rooms | Outline from walls | Lift alignment residual |
|---|---|---|---|
| Basement 2 | 109 | 96% | 0.13 m |
| Basement 1 | 37 | 84% | 0.29 m |
| Garden floor | 151 | 100% | 0 |
| Ground floor | 175 | 98% | reference |
| First–Fifth floor | 181–200 each | 99–100% | 0 (shared coordinates) |

## DXF, layer rules and symbols (wave 16)

- **DXF works as well as DWG**: give `.dxf` files in the config's `"file"` entries. `dxf.mjs` reads ASCII DXF (lines,
  polylines, arcs, circles, text, blocks, dimensions). A file that states its units (`$INSUNITS`) is converted to
  millimetres; one that doesn't is read as millimetres and the Drawing quality page says so.
- **Layer rules per building**: add `"layers"` to the config to read layer names this template uses, tried before the
  built-in rules (`rules.mjs`): `"layers": { "wall": ["^A-PART"], "door": [], "glass": [], "column": [], "ignore": ["^OLD-"], "roomText": [] }`
  (case-insensitive regular expressions on the layer name).
- **Symbols**: blocks whose names say what they are become symbols: equipment (MRI, CT, X-ray, theatre tables and
  lights, incubators, dental chairs), furniture (beds, stretchers, couches), sanitary fittings and medical gas outlets.
  Add a building's own names under `"symbols"`: `[{ "match": "^BED-ICU", "kind": "furniture", "code": "FUR-BED", "label": "ICU bed" }]`
  (`kind`: equipment, furniture, sanitary or outlet; `code`: a catalogue code, or `GAS-O2` / `GAS-VAC` / `GAS-AIR` / `GAS-AIR7` /
  `GAS-N2O` / `GAS-AGSS` for outlets). The import lists the block names it didn't recognise, most used first, on the
  Drawing quality page: that's the list to write rules for.
- **What symbols do in the app**: each lands in the room it's in. Gas outlets count towards the room standards where
  the room survey has no figure; beds, equipment and fittings are drawn in the 3D view where the drawing shows them
  (before illustrative room kits, after registered devices).
- **Dimensions**: typed dimension figures are compared with the distances they span; a plan drawn at the wrong scale
  shows as "Dimensions disagree with the drawing".
- **Try it without drawings**: `node tools/cad/sample/make-sample.mjs /tmp/sample` writes a two-floor DXF sample and
  its config; `npm run cad:import -- /tmp/sample /tmp/sample/sample.json` runs the whole pipeline on it.
