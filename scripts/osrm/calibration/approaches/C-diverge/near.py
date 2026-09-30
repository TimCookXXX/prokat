"""Участки OSM рядом с точкой: python near.py <lat> <lon> [радиус м]"""
import pickle, sys, math
idx = pickle.load(open("/Users/timur/Desktop/sravniprokat/data/calibration/approaches/C-diverge/osmindex.pkl", "rb"))
lat, lon = float(sys.argv[1]), float(sys.argv[2]); R = float(sys.argv[3]) if len(sys.argv) > 3 else 200
def d(a):
    return math.hypot((a[0] - lat) * 111200, (a[1] - lon) * 111200 * math.cos(math.radians(lat)))
rows = []
for w, (t, refs) in idx["ways"].items():
    ds = [d(idx["loc"][n]) for n in refs if n in idx["loc"]]
    if ds and min(ds) < R:
        rows.append((min(ds), w, t, len(refs)))
for dist, w, t, n in sorted(rows)[:40]:
    print(f"{dist:6.0f}м {w} {t}")
