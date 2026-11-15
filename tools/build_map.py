"""Turn raw OpenStreetMap downloads into a compact game map (map.json).

Run:  python -I tools/build_map.py   (from the berlin-game folder)
Coordinates become local meters: x east, y south, origin at the hotel area.
"""
import json, math, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'data', 'raw')
OUT = os.path.join(HERE, '..', 'data', 'map.json')

LAT0, LON0 = 52.5145, 13.4085
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110574.0
# walkable map window (lat/lon)
S, W, N, E = 52.486, 13.362, 52.543, 13.455


def proj(lat, lon):
    return ((lon - LON0) * KX, (LAT0 - lat) * KY)


def load(name):
    with open(os.path.join(RAW, name), encoding='utf8') as f:
        return json.load(f)


def dp(pts, tol):
    """Douglas-Peucker on a list of (x, y); closed rings are split in two."""
    if len(pts) > 3 and pts[0] == pts[-1]:
        m = len(pts) // 2
        return dp(pts[:m + 1], tol)[:-1] + dp(pts[m:], tol)
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


CLASS = {
    'motorway': 0, 'trunk': 0, 'trunk_link': 0, 'primary': 1, 'primary_link': 1,
    'secondary': 2, 'secondary_link': 2, 'tertiary': 3, 'tertiary_link': 3,
    'unclassified': 4, 'residential': 4, 'living_street': 4, 'pedestrian': 5,
}

# ---------- streets ----------
streets = load('streets.json')['elements']
use = collections.Counter()
for w in streets:
    w['nodes'] = [(g['lat'], g['lon']) for g in w.get('geometry', [])]
    for n in w['nodes']:
        use[n] += 1

node_index = {}
nodes = []  # [x, y]
def nid(osm_id, lat, lon):
    if osm_id not in node_index:
        x, y = proj(lat, lon)
        node_index[osm_id] = len(nodes)
        nodes.append((round(x), round(y)))
    return node_index[osm_id]

names = []
name_ix = {}
ways = []
for w in streets:
    c = CLASS.get(w['tags'].get('highway'))
    if c is None:
        continue
    if w['tags'].get('area') == 'yes':
        continue
    nm = w['tags'].get('name', '')
    if nm not in name_ix:
        name_ix[nm] = len(names); names.append(nm)
    geom = w['geometry']; ids = w['nodes']
    if len(ids) < 2:
        continue
    # split at junctions and simplify between them
    seg_start = 0
    out_ids = [nid(ids[0], geom[0]['lat'], geom[0]['lon'])]
    for i in range(1, len(ids)):
        if use[ids[i]] > 1 or i == len(ids) - 1:
            pts = [proj(g['lat'], g['lon']) for g in geom[seg_start:i + 1]]
            idxs = list(range(seg_start, i + 1))
            simp = dp(list(zip(pts, idxs)) and pts, 1.5)
            # map simplified points back to their indices
            keep_set = set()
            j = 0
            for p in simp:
                while pts[j] != p:
                    j += 1
                keep_set.add(idxs[j])
            for k in idxs[1:]:
                if k in keep_set:
                    out_ids.append(nid(ids[k], geom[k]['lat'], geom[k]['lon']))
            seg_start = i
    oneway_foot = 0
    ways.append([c, name_ix[nm], out_ids])

# drop nodes that are now unused (they never got created) -> already compact
print('streets', len(ways), 'nodes', len(nodes), 'names', len(names))

# ---------- areas ----------
areas_raw = [e for e in load('areas.json')['elements'] if e['type'] == 'way'] + load('arearels.json')['elements']
water, parks, rivers = [], [], []

def ring(geom, tol):
    pts = [proj(g['lat'], g['lon']) for g in geom if g]
    pts = dp(pts, tol)
    return [v for p in pts for v in (round(p[0]), round(p[1]))]

def bbox_ok(flat):
    xs = flat[0::2]; ys = flat[1::2]
    if not xs:
        return False
    w = max(xs) - min(xs); h = max(ys) - min(ys)
    return w > 25 or h > 25

for el in areas_raw:
    t = el.get('tags', {})
    kind = None
    if t.get('natural') == 'water':
        kind = 'w'
    elif t.get('waterway') in ('river', 'canal'):
        kind = 'r'
    elif t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('grass', 'forest', 'cemetery'):
        kind = 'p'
    if not kind:
        continue
    rings = []
    if el['type'] == 'way':
        rings.append(ring(el['geometry'], 3 if kind != 'p' else 4))
    else:
        # multipolygon: join outer member ways into rings (simple greedy join)
        segs = [[(g['lat'], g['lon']) for g in m['geometry']] for m in el.get('members', [])
                if m['type'] == 'way' and m.get('role') in ('outer', '') and m.get('geometry')]
        while segs:
            cur = segs.pop(0)
            changed = True
            while changed and cur[0] != cur[-1]:
                changed = False
                for i, s in enumerate(segs):
                    if s[0] == cur[-1]:
                        cur += s[1:]; segs.pop(i); changed = True; break
                    if s[-1] == cur[-1]:
                        cur += s[::-1][1:]; segs.pop(i); changed = True; break
            rings.append(ring([{'lat': a, 'lon': b} for a, b in cur], 3))
    for r in rings:
        if not bbox_ok(r):
            continue
        if kind == 'w':
            water.append(r)
        elif kind == 'r':
            rivers.append([t.get('name', ''), r])
        else:
            parks.append(r)
print('water', len(water), 'parks', len(parks), 'rivers', len(rivers))

# ---------- transit ----------
tr = load('transit2.json')['elements']
tnodes = {x['id']: x for x in tr if x['type'] == 'node'}
COLORS = {'U1': '#7DAD4C', 'U2': '#DA421E', 'U3': '#16683D', 'U5': '#7E5330', 'U6': '#8C6DAB',
          'U8': '#224F86', 'S1': '#DC6BA6', 'S2': '#007734', 'S25': '#007734', 'S3': '#0066AD',
          'S5': '#EB7405', 'S7': '#816DA6', 'S9': '#992746'}
ORDER = ['U1', 'U2', 'U3', 'U5', 'U6', 'U8', 'S1', 'S2', 'S25', 'S3', 'S5', 'S7', 'S9']

station_pts = collections.defaultdict(list)
lines = {}
for r in [x for x in tr if x['type'] == 'relation']:
    ref = r['tags']['ref']
    stops = []
    for m in r['members']:
        if m['type'] == 'node' and m['role'].startswith('stop') and m['ref'] in tnodes:
            n = tnodes[m['ref']]
            nm = n['tags'].get('name', '?')
            nm = nm.replace('S+U ', '').replace('U ', '').replace('S ', '')
            nm = nm.split(' (')[0]
            if stops and stops[-1] == nm:
                continue
            stops.append(nm)
            station_pts[nm].append(proj(n['lat'], n['lon']))
    a, b = r['tags']['name'].split(': ', 1)[1].split(' => ')
    clean = lambda s: s.replace('S+U ', '').replace('U ', '').replace('S ', '').split(' (')[0]
    lines[ref] = {'ref': ref, 'color': COLORS[ref], 'stops': stops,
                  'from': clean(a), 'to': clean(b)}

# U6 relation starts at Kurt-Schumacher-Platz; keep its real terminus name
stations = {}
for nm, pts in station_pts.items():
    x = sum(p[0] for p in pts) / len(pts); y = sum(p[1] for p in pts) / len(pts)
    stations[nm] = [round(x), round(y)]

lines_out = [lines[k] for k in ORDER if k in lines]
print('lines', len(lines_out), 'stations', len(stations))

# window in meters
x0, y0 = proj(N, W); x1, y1 = proj(S, E)
out = {
    'origin': [LAT0, LON0], 'k': [KX, KY],
    'bounds': [round(x0), round(y0), round(x1), round(y1)],
    'nodes': [v for p in nodes for v in p],
    'names': names, 'ways': ways,
    'water': water, 'parks': parks, 'rivers': rivers,
    'stations': stations, 'lines': lines_out,
}
with open(OUT, 'w', encoding='utf8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
