"""Эффект точки: медиана log(км 2ГИС/км OSRM) по парах, где точка — начало / конец (train, day).
Печатает худшие точки и участки подъезда OSRM (первые/последние 400 м)."""
import json, pickle, sys, collections
import numpy as np
sys.path.insert(0, "/Users/timur/Desktop/sravniprokat/scripts/osrm/calibration")
from evalkit import load_work, pair_part
routes = pickle.load(open(sys.argv[1], "rb"))
N = int(sys.argv[2]) if len(sys.argv) > 2 else 25
idx = pickle.load(open("approaches/C-diverge/osmindex.pkl", "rb"))
ways, loc = idx["ways"], idx["loc"]
ref, split = load_work(); day = ref["day"]
pts = {p["id"]: p for p in json.load(open("points.json"))}
part = sys.argv[3] if len(sys.argv) > 3 else "train"
keys = [k for k in day if pair_part(k, split) == part]
es, ed = collections.defaultdict(list), collections.defaultdict(list)
dsrc, ddst = collections.defaultdict(list), collections.defaultdict(list)
for k in keys:
    r = routes[k]; y = np.log(day[k]["m"] / r["m"])
    es[k[0]].append(y); ed[k[1]].append(y)
    dsrc[k[0]].append(day[k]["m"] - r["m"]); ddst[k[1]].append(day[k]["m"] - r["m"])
def wd(w):
    t, refs = ways[w]
    return f"{t.get('highway')}{'/'+t['service'] if 'service' in t else ''}{' acc='+t['access'] if 'access' in t else ''}{' '+t['surface'] if 'surface' in t else ''} «{t.get('name','')}» {w}"
def approach(k, end):
    ws = routes[k]["ways"] if end == "src" else routes[k]["ways"][::-1]
    out, acc = [], 0
    for w, m, s in ws:
        out.append(f"{wd(w)} {m:.0f}м"); acc += m
        if acc > 400: break
    return out
rows = []
for p in pts:
    for end, d, dd in (("src", es, dsrc), ("dst", ed, ddst)):
        if len(d[p]) >= 4:
            rows.append((float(np.median(dd[p])), float(np.median(d[p])), p, end, len(d[p])))
rows.sort(reverse=True)
print(f"точек-концов {len(rows)}; медиана Δм >300: {sum(r[0]>300 for r in rows)}, >1000: {sum(r[0]>1000 for r in rows)}")
for dm, y, p, end, n in rows[:N]:
    k = next(k for k in keys if k[0 if end == 'src' else 1] == p)
    print(f"{p:22s} {end} n={n:2d} медиана Δ {dm:+6.0f} м  logY {y:+.3f}  {pts[p]['lat']:.5f},{pts[p]['lon']:.5f} snap {routes[k]['snap']}")
    for a in approach(k, end):
        print("      ", a)
print("== отрицательные (OSRM длиннее)")
for dm, y, p, end, n in rows[-8:]:
    print(f"{p:22s} {end} n={n:2d} медиана Δ {dm:+6.0f} м  logY {y:+.3f}")
