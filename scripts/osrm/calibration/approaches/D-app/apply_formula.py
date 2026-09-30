"""Независимая проверка app_formula.json: прогноз только по формуле из JSON (как в TS).
python apply_formula.py <app_formula.json> <table.json> <out_pred.json>  (cwd = data/calibration)"""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dfeat import okrug_of  # тот же okrugOfPoint, что в src/lib/compare/geo.ts

af = json.load(open(sys.argv[1])); T = json.load(open(sys.argv[2])); out = sys.argv[3]
C, c = af["constants"], af["coef"]
pts = {p["id"]: p for p in json.load(open("points.json"))}


def south(p):
    return okrug_of(p["lat"], p["lon"]) is None and p["lat"] < 45.045 and 38.85 < p["lon"] < 39.20


def minutes(a, b, dist_m, dur_s):
    X = lambda p: ((p["lon"] - C["CENTER_LON"]) * C["KX_km_per_deg_lon"], (p["lat"] - C["CENTER_LAT"]) * C["KY_km_per_deg_lat"])
    (xa, ya), (xb, yb) = X(a), X(b)
    ra, rb = math.hypot(xa, ya), math.hypot(xb, yb)
    dx, dy = xb - xa, yb - ya; L2 = dx * dx + dy * dy
    u = 0 if L2 == 0 else min(1, max(0, -(xa * dx + ya * dy) / L2))
    rmin = math.hypot(xa + u * dx, ya + u * dy)
    lk = math.log(max(dist_m / 1000, 0.1)); ld = math.log(max(math.hypot(dx, dy), 0.1))
    pos = lambda v: max(0.0, v)
    z = c["c"] + c["ls"] * math.log(dur_s + C["B0_s"]) + c["lk"] * lk + c["ld"] * ld
    for k in C["LEN_KNOTS_km"]:
        z += c[f"ld>{k}"] * pos(ld - math.log(k)) + c[f"lk>{k}"] * pos(lk - math.log(k))
    for k in C["R_KNOTS_km"]:
        z += c[f"r>{k}"] * (pos(ra - k) + pos(rb - k))
    z += c["rmin<3"] * (rmin < 3) + c["cross"] * (south(a) != south(b))
    z += c["north"] * (pos(ya) + pos(yb)) + c["south"] * (pos(-ya) + pos(-yb)) + c["east"] * (pos(xa) + pos(xb)) + c["west"] * (pos(-xa) + pos(-xb))
    base = dur_s + C["GUARD_BASE_S"]
    return min(C["GUARD_HI"] * base, max(C["GUARD_LO"] * base, math.exp(z))) / 60


pred = {}
for k, t in T.items():
    s, d = k.split("|")
    pred[k] = None if t["s"] is None else [t["m"] / 1000, minutes(pts[s], pts[d], t["m"], t["s"])]
json.dump(pred, open(out, "w"), ensure_ascii=False)
print(out, len(pred))
