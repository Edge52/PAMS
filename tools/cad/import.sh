#!/usr/bin/env bash
# Import a hospital's DWG floor plans into the 3D model and the system.
#   npm run cad:import -- <folder with the DWG files> [tools/cad/floors.json]
# Then load it: npm run db:seed (or npm run demo), which imports every building in seed-data/cad/.
# Needs Node 22+ and Python 3 with numpy, scipy, opencv-python, shapely, pillow:
#   pip install numpy scipy opencv-python-headless shapely pillow
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
cad="${1:?Give the folder that holds the DWG files}"; cfg="${2:-$here/floors.json}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
out="$root/$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['output'])" "$cfg")"
python3 -c "import json,sys; [print(f['code'] + '\t' + f['file']) for f in json.load(open(sys.argv[1]))['floors']]" "$cfg" |
while IFS=$'\t' read -r code file; do
  echo "· $code  $file"
  node --max-old-space-size=6000 "$here/extract.mjs" "$cad/$file" "$work/$code.json" 2>&1 | grep -v "error code" || true
  (cd "$work" && python3 "$here/rooms.py" "$code.json" "$code-rooms.json")
done
mkdir -p "$(dirname "$out")"
python3 "$here/build.py" "$cfg" "$work" "$out"
echo "Done. Load it with: npm run db:seed   (existing facilities with the same code are left as they are)"
