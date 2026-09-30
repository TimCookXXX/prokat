"""Прогон /table с произвольными доп. параметрами (одна строка запроса, как у сайта).
python collect_variant.py <osrm_url> <out.json> "<доп. параметры>"  — {approaches} заменяется на curb;curb;…"""
import json, sys, urllib.request
from collections import defaultdict

url, out, extra = sys.argv[1], sys.argv[2], sys.argv[3]
ref = sys.argv[4] if len(sys.argv) > 4 else "work/train_val.jsonl"
pts = {p["id"]: p for p in json.load(open("points.json"))}
by_src = defaultdict(set)
for r in map(json.loads, open(ref)):
    by_src[r["src"]].add(r["dst"])
res = {}
for s, dsts in by_src.items():
    dsts = sorted(dsts)
    n = len(dsts) + 1
    coords = ";".join(f"{pts[i]['lon']:.6f},{pts[i]['lat']:.6f}" for i in [s] + dsts)
    e = extra.replace("{approaches}", ";".join(["curb"] * n)).replace("{unrestricted}", ";".join(["unrestricted"] * n))
    q = f"{url}/table/v1/driving/{coords}?sources=0&annotations=distance,duration{e}"
    d = json.load(urllib.request.urlopen(q, timeout=60))
    w = d["destinations"]
    for j, t in enumerate(dsts):
        res[f"{s}|{t}"] = {"m": d["distances"][0][j + 1], "s": d["durations"][0][j + 1],
                           "snap_src": w[0]["distance"], "snap_dst": w[j + 1]["distance"],
                           "loc_src": w[0]["location"], "loc_dst": w[j + 1]["location"]}
json.dump(res, open(out, "w"))
print(out, len(res))
