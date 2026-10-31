import json, sys
from PIL import Image, ImageDraw
d = json.load(open(sys.argv[1])); out = sys.argv[2]
xs = [r['x'] for r in d['rooms']]; ys = [r['y'] for r in d['rooms']]
for s in d['segs']['wall']: xs += [s[0], s[2]]; ys += [s[1], s[3]]
xs.sort(); ys.sort(); q = lambda a, f: a[int(len(a) * f)]
x0, x1, y0, y1 = q(xs, .005) - 3000, q(xs, .995) + 3000, q(ys, .005) - 3000, q(ys, .995) + 3000
W = 2400; S = W / (x1 - x0); H = int((y1 - y0) * S)
im = Image.new('RGB', (W, H), 'white'); dr = ImageDraw.Draw(im)
T = lambda x, y: ((x - x0) * S, H - (y - y0) * S)
for k, col in [('door', (190, 190, 190)), ('glass', (80, 160, 220)), ('wall', (20, 20, 20)), ('col', (200, 0, 0))]:
    for s in d['segs'][k]: dr.line([T(s[0], s[1]), T(s[2], s[3])], fill=col, width=1)
for r in d['rooms']:
    x, y = T(r['x'], r['y']); dr.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(230, 120, 0)); dr.text((x + 4, y - 5), (r['num'] or '?'), fill=(200, 80, 0))
im.save(out); print(out, W, H, 'extent m', round((x1 - x0) / 1000), round((y1 - y0) / 1000))
