"""Варианты /table для проверки: обратное направление (куда → откуда) и snapping=any.
python collect_table2.py <osrm_url> <out.json> rev|any"""
import json, sys, urllib.request
from collections import defaultdict

url, out, mode = sys.argv[1], sys.argv[2], sys.argv[3]
pts = {p["id"]: p for p in json.load(open("points.json"))}
by_src = defaultdict(set)
for r in map(json.loads, open("work/train_val.jsonl")):
    by_src[r["src"]].add(r["dst"])
res = {}
for s, dsts in by_src.items():
    dsts = sorted(dsts)
    coords = ";".join(f"{pts[i]['lon']:.6f},{pts[i]['lat']:.6f}" for i in [s] + dsts)
    if mode == "rev":
        q = f"{url}/table/v1/driving/{coords}?destinations=0&annotations=distance,duration"
        d = json.load(urllib.request.urlopen(q, timeout=60))
        for j, t in enumerate(dsts):
            res[f"{s}|{t}"] = {"m": d["distances"][j + 1][0], "s": d["durations"][j + 1][0]}
    else:
        q = f"{url}/table/v1/driving/{coords}?sources=0&annotations=distance,duration&snapping=any"
        d = json.load(urllib.request.urlopen(q, timeout=60))
        w = d["destinations"]
        for j, t in enumerate(dsts):
            res[f"{s}|{t}"] = {"m": d["distances"][0][j + 1], "s": d["durations"][0][j + 1],
                               "snap_src": w[0]["distance"], "snap_dst": w[j + 1]["distance"]}
json.dump(res, open(out, "w"))
print(out, len(res))
