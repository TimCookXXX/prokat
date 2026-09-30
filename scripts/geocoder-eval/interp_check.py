#!/usr/bin/env python3
"""Проверка «исключи один» интерполяции ГАР (правила scripts/geocoder/build.py) на части замера val или test.
build.py гоняет её только на train (там подбирались правила). Здесь — те же функции без записи в БД:
сборка OSM-части до точек улиц, затем validate_interpolation с частью замера, подменённой на нужную.

  python scripts/geocoder-eval/interp_check.py val|test [--i-know-this-is-test]
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
sys.path.insert(0, os.path.join(ROOT, "scripts/geocoder"))
import pickle  # noqa: E402

import build as b  # noqa: E402

split = sys.argv[1]
if split not in ("val", "test") or (split == "test" and "--i-know-this-is-test" not in sys.argv):
    sys.exit("val | test --i-know-this-is-test")
if split == "test":
    with open(os.path.join(ROOT, "data/geocoder/research/eval/out/vault/OPENED.log"), "a") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M')} interp_check.py (улицы test, интерполяция ГАР «исключи один»)\n")

osm = pickle.load(open(os.path.join(ROOT, "data/geocoder/work/osm.pkl"), "rb"))
okrugs_gd, micro_gd = b.read_geo_data(os.path.join(ROOT, "src/lib/compare/geo-data.ts"), "krasnodar")
P = b.build_places(osm, okrugs_gd, micro_gd, "Краснодар")
loc = b.settlement_locator(P)
b.build_snts(P, osm, loc)
b.snt_from_labels(P, osm, loc)
locate_snt = b.poly_locator(P.snts)
gar_data = b.read_gar(os.path.join(ROOT, "data/geocoder/work/gar"))
streets, addrs = b.cluster_streets(P, osm, loc, locate_snt, b.gar_same_name_streets(gar_data[0], gar_data[1]))
b.snap_nodes(osm, addrs)
houses = b.osm_houses(P, streets, addrs, loc, locate_snt)
for h in houses:
    if h.street is not None:
        h.street.osm_house_by_norm[h.norm] = h
for s in streets:
    pt = b.street_point(s)
    if pt is None:
        hs = list(s.osm_house_by_norm.values()) or [b.House(None, None, "", "", d["x"], d["y"], "house", "osm") for d in s.houses]
        mx = sorted(h.x for h in hs)[len(hs) // 2]
        my = sorted(h.y for h in hs)[len(hs) // 2]
        ref = min(hs, key=lambda h: b.dist((h.x, h.y), (mx, my)))
        pt = (ref.x, ref.y)
    s.x, s.y = pt
orig = b.eval_split
b.eval_split = lambda s: "train" if orig(s) == split else "other"  # validate_interpolation берёт только «train»
out = b.validate_interpolation(streets)
out["streets"] = split
print(json.dumps(out, ensure_ascii=False, indent=1))
