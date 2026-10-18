"""Build the offline vector basemap from Natural Earth (public domain).

Output (web/public/basemap/):
  overview.json            1:50m land polygons + coastline + borders (global, small zoom)
  tiles/{x}_{y}.json       1:10m land / coastline / borders clipped to 10° tiles (detail zoom)
  index.json               list of non-empty tiles

Usage:  python tools/build_basemap.py [natural_earth_dir]
Default source: cartopy's cache (~/.local/share/cartopy/shapefiles/natural_earth).
"""
import gzip, json, sys
from pathlib import Path
import shapefile

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / '.local/share/cartopy/shapefiles/natural_earth'
OUT = Path(__file__).resolve().parents[1] / 'web' / 'public' / 'basemap'
TILE = 10.0; PAD = 0.02
# (decimals, minimum vertex spacing in degrees): overview is drawn at z<4.5, tiles up to z≈11.
PRECISION = {'overview': (3, 0.025), 'tile': (4, 0.0015)}
MODE = ['tile']

def area(ring):
    return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2

def polygons(shape):
    """Shapefile parts → [[outer, *holes], ...]. Shapefile outers are clockwise (negative area)."""
    parts = list(shape.parts) + [len(shape.points)]; out = []
    for a, b in zip(parts[:-1], parts[1:]):
        ring = [tuple(p) for p in shape.points[a:b]]
        if len(ring) < 4: continue
        if area(ring) <= 0 or not out: out.append([ring])
        else: out[-1].append(ring)
    return out

def lines(shape):
    parts = list(shape.parts) + [len(shape.points)]
    return [[tuple(p) for p in shape.points[a:b]] for a, b in zip(parts[:-1], parts[1:]) if b - a >= 2]

def clip_ring(ring, w, s, e, n):
    """Sutherland–Hodgman against an axis-aligned box."""
    def clip(pts, inside, cross):
        out = []
        for i in range(len(pts)):
            cur, prev = pts[i], pts[i - 1]
            if inside(cur):
                if not inside(prev): out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev): out.append(cross(prev, cur))
        return out
    def at_x(x): return lambda p, c: (x, p[1] + (c[1] - p[1]) * (x - p[0]) / ((c[0] - p[0]) or 1e-12))
    def at_y(y): return lambda p, c: (p[0] + (c[0] - p[0]) * (y - p[1]) / ((c[1] - p[1]) or 1e-12), y)
    pts = ring[:-1]
    for inside, cross in ((lambda p: p[0] >= w, at_x(w)), (lambda p: p[0] <= e, at_x(e)), (lambda p: p[1] >= s, at_y(s)), (lambda p: p[1] <= n, at_y(n))):
        pts = clip(pts, inside, cross)
        if not pts: return None
    return pts + [pts[0]] if len(pts) >= 3 else None

def clip_line(line, w, s, e, n):
    """Liang–Barsky per segment, re-joined into runs."""
    runs, cur = [], []
    for a, b in zip(line[:-1], line[1:]):
        t0, t1, dx, dy = 0.0, 1.0, b[0] - a[0], b[1] - a[1]; ok = True
        for p, qq in ((-dx, a[0] - w), (dx, e - a[0]), (-dy, a[1] - s), (dy, n - a[1])):
            if p == 0:
                if qq < 0: ok = False; break
            else:
                t = qq / p
                if p < 0: t0 = max(t0, t)
                else: t1 = min(t1, t)
                if t0 > t1: ok = False; break
        if not ok:
            if len(cur) > 1: runs.append(cur)
            cur = []; continue
        p0 = (a[0] + t0 * dx, a[1] + t0 * dy); p1 = (a[0] + t1 * dx, a[1] + t1 * dy)
        if cur and cur[-1] == p0: cur.append(p1)
        else:
            if len(cur) > 1: runs.append(cur)
            cur = [p0, p1]
        if t1 < 1:
            runs.append(cur); cur = []
    if len(cur) > 1: runs.append(cur)
    return runs

def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; return min(xs), min(ys), max(xs), max(ys)

def dedupe(pts):
    """Quantise and drop vertices closer than the mode's spacing (keeps first/last so rings stay closed)."""
    digits, tol = PRECISION[MODE[0]]; out = []
    for i, p in enumerate(pts):
        p = [round(p[0], digits), round(p[1], digits)]
        if out and (abs(p[0] - out[-1][0]) < tol and abs(p[1] - out[-1][1]) < tol) and i != len(pts) - 1: continue
        if not out or out[-1] != p: out.append(p)
    return out

def write(path, text):
    """Plain file plus a precompressed .gz sibling (served when the browser accepts gzip)."""
    path.write_text(text); path.with_name(path.name + '.gz').write_bytes(gzip.compress(text.encode(), 9))

def fc(features): return {'type': 'FeatureCollection', 'features': features}

def poly_feature(rings, kind='land'):
    rings = [dedupe(r) for r in rings]; rings = [r for r in rings if len(r) >= 4 and abs(area(r)) > 1e-7]
    return {'type': 'Feature', 'properties': {'k': kind}, 'geometry': {'type': 'Polygon', 'coordinates': rings}} if rings else None

def line_feature(pts, kind):
    pts = dedupe(pts)
    return {'type': 'Feature', 'properties': {'k': kind}, 'geometry': {'type': 'LineString', 'coordinates': pts}} if len(pts) >= 2 else None

def read(name): return shapefile.Reader(str(SRC / name))

def main():
    (OUT / 'tiles').mkdir(parents=True, exist_ok=True)
    # overview (1:50m)
    MODE[0] = 'overview'; feats = []
    for s in read('physical/ne_50m_land').iterShapes():
        for poly in polygons(s):
            f = poly_feature(poly);  f and feats.append(f)
    # Overview polygons are unclipped, so their outline is the coastline (no separate coast layer needed).
    for s in read('cultural/ne_50m_admin_0_boundary_lines_land').iterShapes():
        for l in lines(s):
            f = line_feature(l, 'border'); f and feats.append(f)
    write(OUT / 'overview.json', json.dumps(fc(feats), separators=(',', ':')))
    # detail tiles (1:10m)
    MODE[0] = 'tile'
    land = [(poly, bbox(poly[0])) for s in read('physical/ne_10m_land').iterShapes() for poly in polygons(s)]
    coast = [(l, bbox(l)) for s in read('physical/ne_10m_coastline').iterShapes() for l in lines(s)]
    borders = [(l, bbox(l)) for s in read('cultural/ne_10m_admin_0_boundary_lines_land').iterShapes() for l in lines(s)]
    index = []; total = 0
    for x in range(int(360 / TILE)):
        for y in range(int(180 / TILE)):
            w, s_ = -180 + x * TILE, -90 + y * TILE; e, n = w + TILE, s_ + TILE
            W, S, E, N = w - PAD, s_ - PAD, e + PAD, n + PAD
            hit = lambda b: b[0] <= E and b[2] >= W and b[1] <= N and b[3] >= S
            feats = []
            for poly, b in land:
                if not hit(b): continue
                outer = clip_ring(poly[0], W, S, E, N)
                if not outer: continue
                holes = [h for h in (clip_ring(r, W, S, E, N) for r in poly[1:] if hit(bbox(r))) if h]
                f = poly_feature([outer, *holes]); f and feats.append(f)
            for kind, src in (('coast', coast), ('border', borders)):
                for l, b in src:
                    if not hit(b): continue
                    for run in clip_line(l, w, s_, e, n):
                        f = line_feature(run, kind); f and feats.append(f)
            if not feats: continue
            data = json.dumps(fc(feats), separators=(',', ':')); total += len(data)
            write(OUT / 'tiles' / f'{x}_{y}.json', data); index.append([x, y])
    (OUT / 'index.json').write_text(json.dumps({'tile': TILE, 'tiles': index, 'source': 'Natural Earth 1:10m / 1:50m (public domain)'}))
    print(f'overview {(OUT / "overview.json").stat().st_size / 1e6:.2f} MB; {len(index)} tiles, {total / 1e6:.1f} MB')

if __name__ == '__main__':
    main()
