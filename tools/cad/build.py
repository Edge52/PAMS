"""Merge per-floor CAD extractions into one building model for the app.

Floors are drawn in different coordinate systems, so each floor is aligned to the reference floor with a rigid
transform (rotation + translation) fitted to the lift labels ("Elevator - N"), which sit on vertical shafts.
Output: plan units = 1 per 100 mm, y pointing down (same convention as the app's 2D floor map).
"""
import json, math, sys
import numpy as np
from shapely.geometry import Polygon

# Usage: python3 build.py <floors.json> <work dir with <code>-rooms.json files> <output.json>
cfg = json.load(open(sys.argv[1])); work = sys.argv[2]; out_path = sys.argv[3]
FLOORS = [(f["code"], f["name"], f["level"]) for f in cfg["floors"]]
FLOOR_TO_FLOOR_M = cfg.get("floorToFloorMetres", 4.5)
REF = cfg.get("referenceFloor") or FLOORS[0][0]
UNIT_MM = 100.0  # 1 plan unit = 100 mm → 10 units per metre

data = {}
for code, name, level in FLOORS:
    try: data[code] = json.load(open(f"{work}/{code}-rooms.json"))
    except FileNotFoundError: print("missing", code)

def lift_candidates(d):
    """Every position of every lift label (a drawing may repeat labels in a key plan)."""
    return {k: [np.array(p, float) for p in v] for k, v in (d.get("lifts") or {}).items()}

def fit_rigid(src, dst):
    """Least-squares rotation + translation mapping src→dst (Kabsch, no scaling)."""
    A, B = np.array(src), np.array(dst)
    ca, cb = A.mean(0), B.mean(0)
    H = (A - ca).T @ (B - cb)
    U, _, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T
    if np.linalg.det(R) < 0: Vt[1] *= -1; R = Vt.T @ U.T
    return R, cb - R @ ca

def consensus_fit(cands, ref, tol=1500.0):
    """RANSAC over pairs of lift labels: hypothesise a rigid transform from two labels, keep the one most lifts agree with.
    Each lift then uses the candidate position closest to its reference, and the transform is refit on those."""
    common = sorted(set(cands) & set(ref), key=int)
    best = None
    for i in range(len(common)):
        for j in range(i + 1, len(common)):
            a, b = common[i], common[j]
            dref = np.linalg.norm(ref[a] - ref[b])
            if dref < 3000: continue  # too close to fix a rotation
            for pa in cands[a]:
                for pb in cands[b]:
                    if abs(np.linalg.norm(pa - pb) - dref) > tol: continue
                    R, t = fit_rigid([pa, pb], [ref[a], ref[b]])
                    pairs = []
                    for k in common:
                        dists = [np.linalg.norm(R @ p + t - ref[k]) for p in cands[k]]
                        m = int(np.argmin(dists))
                        if dists[m] < tol: pairs.append((cands[k][m], ref[k]))
                    if best is None or len(pairs) > len(best):
                        best = pairs
    if not best or len(best) < 2: return None
    R, t = fit_rigid([p for p, _ in best], [q for _, q in best])
    rms = float(np.sqrt(np.mean([np.linalg.norm(R @ p + t - q) ** 2 for p, q in best])))
    return R, t, rms, len(best)

# Reference lifts: the reference floor's labels (first position of each).
ref = {k: v[0] for k, v in lift_candidates(data[REF]).items()}
transforms = {}
for code, d in data.items():
    if code == REF:
        transforms[code] = (np.eye(2), np.zeros(2), 0.0, len(ref)); continue
    fit = consensus_fit(lift_candidates(d), ref)
    if fit is None:
        print(f"{code}: lifts don't match the reference floor — left unaligned")
        transforms[code] = (np.eye(2), np.zeros(2), float("nan"), 0)
    else:
        transforms[code] = fit

for code, (R, t, rms, n) in transforms.items():
    ang = math.degrees(math.atan2(R[1, 0], R[0, 0]))
    print(f"{code}: {n} lifts, rotation {ang:+.2f}°, shift ({t[0]/1000:+.1f}, {t[1]/1000:+.1f}) m, residual {rms:.0f} mm")

def tf(code, x, y):
    R, t, _, _ = transforms[code]
    p = R @ np.array([x, y], float) + t
    return float(p[0]), float(p[1])

# Per-floor robust extents after alignment; each floor is clipped to the other floors' footprint (+10 m) so stray
# copies in a drawing (key plans, details placed off to the side) don't end up in the building.
def floor_box(code, d):
    xs, ys = [], []
    for s in d["segs"]["wall"]:
        for x, y in ((s[0], s[1]), (s[2], s[3])):
            X, Y = tf(code, x, y); xs.append(X); ys.append(Y)
    if not xs: return None
    xs.sort(); ys.sort(); q = lambda a, f: a[int(len(a) * f)]
    return (q(xs, .01), q(ys, .01), q(xs, .99), q(ys, .99))
boxes = {c: floor_box(c, d) for c, d in data.items()}
CLIP_PAD = 10000
clip = {}
for c in data:
    others = [b for k, b in boxes.items() if k != c and b]
    clip[c] = (min(b[0] for b in others) - CLIP_PAD, min(b[1] for b in others) - CLIP_PAD,
               max(b[2] for b in others) + CLIP_PAD, max(b[3] for b in others) + CLIP_PAD) if others else (-1e12, -1e12, 1e12, 1e12)
in_clip = lambda c, X, Y: clip[c][0] <= X <= clip[c][2] and clip[c][1] <= Y <= clip[c][3]

xs, ys = [], []
for code, d in data.items():
    for s in d["segs"]["wall"]:
        for x, y in ((s[0], s[1]), (s[2], s[3])):
            X, Y = tf(code, x, y)
            if in_clip(code, X, Y): xs.append(X); ys.append(Y)
xs.sort(); ys.sort(); q = lambda a, f: a[int(len(a) * f)]
pad = 6000
X0, X1, Y0, Y1 = q(xs, .002) - pad, q(xs, .998) + pad, q(ys, .002) - pad, q(ys, .998) + pad
W, H = math.ceil((X1 - X0) / UNIT_MM), math.ceil((Y1 - Y0) / UNIT_MM)
P = lambda X, Y: (round((X - X0) / UNIT_MM, 1), round((Y1 - Y) / UNIT_MM, 1))
inside = lambda u, v: -20 <= u <= W + 20 and -20 <= v <= H + 20

def segs(code, items, min_len_mm=40):
    out = []
    for s in items:
        a, b = tf(code, s[0], s[1]), tf(code, s[2], s[3])
        if math.dist(a, b) < min_len_mm or not (in_clip(code, *a) and in_clip(code, *b)): continue
        (u1, v1), (u2, v2) = P(*a), P(*b)
        if inside(u1, v1) and inside(u2, v2): out += [u1, v1, u2, v2]
    return out

ROOM_CODE_SAFE = lambda s: "".join(ch for ch in s.upper() if ch.isalnum() or ch == "-")[:32]
floors_out = []
for code, name, level in FLOORS:
    if code not in data: continue
    d = data[code]
    rooms, seen = [], set()
    for i, r in enumerate(d["rooms"]):
        if not r.get("poly") or len(r["poly"]) < 3: continue
        if not in_clip(code, *tf(code, r["x"], r["y"])): continue
        poly = [P(*tf(code, x, y)) for x, y in r["poly"]]
        if not all(inside(u, v) for u, v in poly): continue
        cx, cy = P(*tf(code, r["x"], r["y"]))
        base = "-".join(p for p in [code, r.get("dept"), r.get("num")] if p) or f"{code}-R{i + 1}"
        rc = ROOM_CODE_SAFE(base); k = 2
        while rc in seen: rc = ROOM_CODE_SAFE(f"{base}-{k}"); k += 1
        seen.add(rc)
        rooms.append({"code": rc, "name": (r.get("name") or "").strip()[:200] or rc, "dept": r.get("dept"), "num": r.get("num"),
                      "shape": r.get("shape"), "area": r.get("area_m2"), "poly": poly, "label": [cx, cy]})
    floors_out.append({
        "code": code, "name": name, "level": level, "elevation": level * FLOOR_TO_FLOOR_M, "sourceFile": d["file"],
        "walls": segs(code, d["segs"]["wall"]), "doors": segs(code, d["segs"]["door"]), "glass": segs(code, d["segs"]["glass"]),
        "columns": segs(code, d["segs"]["col"]), "rooms": rooms,
        "alignment": {"lifts": transforms[code][3], "residualMm": None if math.isnan(transforms[code][2]) else round(transforms[code][2])},
    })
    print(f"{code} {name}: {len(rooms)} rooms, {len(floors_out[-1]['walls']) // 4} wall segments")

building = {"name": cfg["building"], "facilityCode": cfg.get("facilityCode"), "source": ", ".join(f["file"] for f in cfg["floors"]), "unitsPerMetre": 1000 / UNIT_MM,
            "planWidth": W, "planHeight": H, "floors": floors_out}
json.dump(building, open(out_path, "w"), separators=(",", ":"))
print("wrote", out_path, f"{W}x{H} plan units ({W / 10:.0f} m × {H / 10:.0f} m)")
