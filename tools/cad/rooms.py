"""Room outlines by flood fill: rasterise walls/doors/glass/columns, label the free space, give each room tag its region.
Regions holding several tags are split between them (nearest tag). Output polygons in mm."""
import json, sys
import numpy as np, cv2
from scipy.spatial import cKDTree
from shapely.geometry import Polygon
d = json.load(open(sys.argv[1])); out = sys.argv[2]
RES = 50.0  # mm per cell
rooms = d['rooms']
xs = [r['x'] for r in rooms]; ys = [r['y'] for r in rooms]
for s in d['segs']['wall']: xs += [s[0], s[2]]; ys += [s[1], s[3]]
xs.sort(); ys.sort(); q = lambda a, f: a[int(len(a) * f)]
x0, x1 = q(xs, .005) - 4000, q(xs, .995) + 4000; y0, y1 = q(ys, .005) - 4000, q(ys, .995) + 4000
W, H = int((x1 - x0) / RES) + 1, int((y1 - y0) / RES) + 1
P = lambda x, y: (int(round((x - x0) / RES)), int(round((y1 - y) / RES)))
mask = np.zeros((H, W), np.uint8)
for k in ('wall', 'door', 'glass', 'col'):
    for s in d['segs'][k]: cv2.line(mask, P(s[0], s[1]), P(s[2], s[3]), 255, 3)
def to_poly(m, grow):
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs: return None
    c = max(cs, key=cv2.contourArea)
    if cv2.contourArea(c) < 4: return None
    c = cv2.approxPolyDP(c, 2.0, True)[:, 0, :]
    pts = [(round(x0 + px * RES), round(y1 - py * RES)) for px, py in c]
    if len(pts) < 3: return None
    p = Polygon(pts).buffer(0).buffer(grow, join_style=2).simplify(60)
    if p.geom_type == 'MultiPolygon': p = max(p.geoms, key=lambda g: g.area)
    if p.geom_type != 'Polygon' or p.is_empty: return None
    return [[round(x), round(y)] for x, y in list(p.exterior.coords)[:-1]]

# Doors are often separate objects, so doorways are gaps in the walls. Try increasingly wide gap-bridging and give
# each room the smallest one that encloses it on its own (bridging also seals gaps in the facade).
KERNELS_MM = [0, 900, 1300, 1800]
levels = []
for kmm in KERNELS_MM:
    m = mask if kmm == 0 else cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (int(kmm / RES) | 1, int(kmm / RES) | 1)))
    free = (m == 0).astype(np.uint8)
    n, lab = cv2.connectedComponents(free, connectivity=4)
    area = np.bincount(lab.ravel(), minlength=n) * (RES / 1000) ** 2
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist())
    def cell_label(x, y, lab=lab, m=m):
        c, r = P(x, y)
        for rad in range(0, 14):
            sl = (slice(max(0, r - rad), r + rad + 1), slice(max(0, c - rad), c + rad + 1))
            vals = lab[sl][(lab[sl] > 0) & (m[sl] == 0)]
            if vals.size: return int(np.bincount(vals).argmax())
        return 0
    labs = [cell_label(r['x'], r['y']) for r in rooms]
    count = {}
    for L in labs: count[L] = count.get(L, 0) + 1
    levels.append(dict(k=kmm, lab=lab, area=area, border=border, labs=labs, count=count, mask=m))

stats = {'walls': 0, 'split': 0, 'fallback': 0}
done = set()
for i, r in enumerate(rooms):          # pass 1: a room alone in a closed region
    for lv in levels:
        L = lv['labs'][i]
        if L and L not in lv['border'] and lv['area'][L] < 1500 and lv['count'][L] == 1:
            r['poly'] = to_poly((lv['lab'] == L).astype(np.uint8) * 255, 75 + lv['k'] / 4); r['shape'] = 'walls'
            if r['poly']: stats['walls'] += 1; done.add(i)
            break
for lv in levels:                       # pass 2: rooms sharing a closed region are split between them
    groups = {}
    for i in range(len(rooms)):
        if i in done: continue
        L = lv['labs'][i]
        if L and L not in lv['border'] and lv['area'][L] < 6000: groups.setdefault(L, []).append(i)
    for L, idxs in groups.items():
        others = [j for j in done if lv['labs'][j] == L]   # already-placed rooms carve out their space
        region = (lv['lab'] == L)
        for j in others:
            if rooms[j].get('poly'):
                cv2.fillPoly(region.view(np.uint8), [np.array([P(*p) for p in rooms[j]['poly']], np.int32)], 0)
        ys_, xs_ = np.nonzero(region)
        if not len(xs_): continue
        tree = cKDTree([P(rooms[i]['x'], rooms[i]['y']) for i in idxs]); dist, nn = tree.query(np.c_[xs_, ys_])
        for jj, i in enumerate(idxs):
            sel = (nn == jj) & (dist < 12000 / RES)
            mm = np.zeros(region.shape, np.uint8); mm[ys_[sel], xs_[sel]] = 255
            rooms[i]['poly'] = to_poly(mm, 75); rooms[i]['shape'] = 'split'
            if rooms[i]['poly']: stats['split'] += 1; done.add(i)
for i, r in enumerate(rooms):
    if i not in done:
        r['poly'] = [[r['x'] - 1500, r['y'] - 1500], [r['x'] + 1500, r['y'] - 1500], [r['x'] + 1500, r['y'] + 1500], [r['x'] - 1500, r['y'] + 1500]]
        r['shape'] = 'fallback'; stats['fallback'] += 1
for r in rooms: r.pop('_L', None); r['area_m2'] = round(Polygon(r['poly']).area / 1e6, 1) if r.get('poly') and len(r['poly']) >= 3 else None
d['rooms'] = rooms; d['bounds'] = [x0, y0, x1, y1]
json.dump(d, open(out, 'w'))
print(sys.argv[1], stats, 'no poly', sum(1 for r in rooms if not r.get('poly')))
# preview
S = 2400 / (x1 - x0); im = np.full((int((y1 - y0) * S), 2400, 3), 255, np.uint8); T = lambda x, y: (int((x - x0) * S), int((y1 - y) * S))
rng = np.random.default_rng(1)
for r in rooms:
    if r.get('poly'):
        col = (180, 180, 180) if r['shape'] == 'fallback' else tuple(int(v) for v in rng.integers(120, 235, 3))
        cv2.fillPoly(im, [np.array([T(*p) for p in r['poly']], np.int32)], col)
for s in d['segs']['wall']: cv2.line(im, T(s[0], s[1]), T(s[2], s[3]), (30, 30, 30), 1)
cv2.imwrite(out.replace('.json', '-rooms.png'), im)
