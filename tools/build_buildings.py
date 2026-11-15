"""Building outlines and heights for the 3D view -> data/buildings.json

Each building: [height_dm, n, x0*2, y0*2, dx1*2, dy1*2, ...]  (half-meter grid, deltas after the first point)
Run:  python -I tools/build_buildings.py   (from the berlin-game folder)
"""
import json, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'data', 'raw')
OUT = os.path.join(HERE, '..', 'data', 'buildings.json')
LAT0, LON0 = 52.5145, 13.4085
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110574.0
proj = lambda lat, lon: ((lon - LON0) * KX, (LAT0 - lat) * KY)

def num(v):
    if not v:
        return None
    m = re.match(r'\s*([0-9]+(?:[.,][0-9]+)?)', v)
    return float(m.group(1).replace(',', '.')) if m else None

LOW = {'garage', 'garages', 'shed', 'hut', 'roof', 'carport', 'kiosk', 'container', 'toilets', 'bunker', 'service', 'transformer_tower', 'construction'}
def height(t):
    h = num(t.get('height'))
    if h:
        return h
    lv = num(t.get('building:levels'))
    if lv:
        return lv * 3.3 + (num(t.get('roof:levels')) or 0) * 2.5 + 1
    b = t.get('building', 'yes')
    if b in LOW:
        return 3.5
    if b in ('church', 'cathedral'):
        return 30
    return 17  # typical central Berlin block

def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop(); ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True; st += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

def area(pts):
    return sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts))) / 2

seen, out, count, skipped = set(), [], 0, 0
for i in range(1, 5):
    for w in json.load(open(os.path.join(RAW, f'bld{i}.json'), encoding='utf8'))['elements']:
        if w['type'] != 'way' or w['id'] in seen or 'geometry' not in w:
            continue
        seen.add(w['id']); t = w.get('tags', {})
        if t.get('building') in ('no', 'ruins') or t.get('location') == 'underground' or t.get('layer', '0').startswith('-'):
            continue
        pts = [proj(g['lat'], g['lon']) for g in w['geometry']]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3:
            continue
        m = len(pts) // 2
        pts = dp(pts[:m + 1], 0.8)[:-1] + dp(pts[m:] + [pts[0]], 0.8)[:-1]
        a = area(pts)
        if abs(a) < 30 or len(pts) < 3:
            skipped += 1; continue
        if a < 0:  # make every ring the same winding (counter-clockwise on screen, y down)
            pts = pts[::-1]
        q = [(round(x * 2), round(y * 2)) for x, y in pts]
        flat = [q[0][0], q[0][1]]
        for k in range(1, len(q)):
            flat += [q[k][0] - q[k - 1][0], q[k][1] - q[k - 1][1]]
        out += [round(min(height(t), 150) * 10), len(q)] + flat
        count += 1

json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print('buildings', count, 'skipped small', skipped, 'size', os.path.getsize(OUT) // 1024, 'KB')
