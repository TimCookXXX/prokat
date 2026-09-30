"""Собирает то, что видит сайт: OSRM /table от точки отправления до точек прибытия
(distance, duration) + привязка точек (waypoints: distance до дороги, location).

python collect_table.py <osrm_url> <out.json> [--ref work/train_val.jsonl]
→ {"src|dst": {"m", "s", "snap_src", "snap_dst", "loc_src", "loc_dst"}}
"""
import json, sys, urllib.request
from collections import defaultdict

url, out = sys.argv[1], sys.argv[2]
ref = sys.argv[sys.argv.index("--ref") + 1] if "--ref" in sys.argv else "work/train_val.jsonl"
pts = {p["id"]: p for p in json.load(open("points.json"))}
by_src = defaultdict(set)
for r in map(json.loads, open(ref)):
    by_src[r["src"]].add(r["dst"])
res = {}
for s, dsts in by_src.items():
    dsts = sorted(dsts)
    coords = ";".join(f"{pts[i]['lon']:.6f},{pts[i]['lat']:.6f}" for i in [s] + dsts)
    d = json.load(urllib.request.urlopen(f"{url}/table/v1/driving/{coords}?sources=0&annotations=distance,duration", timeout=60))
    w = d["destinations"]
    for j, t in enumerate(dsts):
        res[f"{s}|{t}"] = {"m": d["distances"][0][j + 1], "s": d["durations"][0][j + 1],
                           "snap_src": w[0]["distance"], "snap_dst": w[j + 1]["distance"],
                           "loc_src": w[0]["location"], "loc_dst": w[j + 1]["location"]}
json.dump(res, open(out, "w"), ensure_ascii=False)
print(out, len(res))
