#!/usr/bin/env bash
# Import a hospital's DWG or DXF floor plans into the 3D model and the system (one file per floor; layer and symbol
# rules can be added in the config, see tools/cad/README.md).
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
  # LibreDWG prints "error code" lines for harmless read warnings; drop those, but stop when the extract itself fails
  # (audit A15: "|| true" used to hide that, and the next step crashed on a missing or empty file).
  if ! node --max-old-space-size=6000 "$here/extract.mjs" "$cad/$file" "$work/$code.json" "$cfg" >"$work/$code.log" 2>&1; then
    sed '/error code/d' "$work/$code.log" >&2
    echo "✕ Couldn't read $file (floor $code). The import stopped; fix the file or the config and run it again." >&2
    exit 1
  fi
  sed '/error code/d' "$work/$code.log"
  if ! (cd "$work" && python3 "$here/rooms.py" "$code.json" "$code-rooms.json"); then
    echo "✕ Couldn't find the rooms of $file (floor $code). The import stopped." >&2
    exit 1
  fi
done
mkdir -p "$(dirname "$out")"
python3 "$here/build.py" "$cfg" "$work" "$out"
echo "Done. Load it with: npm run db:seed   (existing facilities with the same code are left as they are)"
