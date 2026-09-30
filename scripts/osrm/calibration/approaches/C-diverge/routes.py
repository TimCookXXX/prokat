"""Маршруты OSRM для всех пар эталона с узлами → участки OSM.
python routes.py <url> <out.pkl>  (cwd data/calibration)
out: {(src,dst): {"m","s","ways": [(way_id, метры, секунды)], "nodes": [...]}}"""
import json, pickle, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

url, out = sys.argv[1], sys.argv[2]
idx = pickle.load(open("approaches/C-diverge/osmindex.pkl", "rb"))
edge = idx["edge"]
pts = {p["id"]: p for p in json.load(open("points.json"))}
pairs = sorted({(r["src"], r["dst"]) for r in map(json.loads, open("work/train_val.jsonl"))})


def one(pair):
    a, b = pts[pair[0]], pts[pair[1]]
    q = (f"{url}/route/v1/driving/{a['lon']},{a['lat']};{b['lon']},{b['lat']}"
         "?overview=false&annotations=nodes,distance,duration")
    try:
        d = json.load(urllib.request.urlopen(q, timeout=30))
        r = d["routes"][0]
    except Exception as e:
        return pair, None
    ann = r["legs"][0]["annotation"]
    nodes, dm, ds = ann["nodes"], ann["distance"], ann["duration"]
    ways = []
    for i in range(len(dm)):
        w = edge.get((nodes[i], nodes[i + 1])) if i + 1 < len(nodes) else None
        if ways and ways[-1][0] == w:
            ways[-1][1] += dm[i]; ways[-1][2] += ds[i]
        else:
            ways.append([w, dm[i], ds[i]])
    return pair, {"m": r["distance"], "s": r["duration"], "ways": ways, "nodes": nodes,
                  "snap": [w["distance"] for w in d["waypoints"]]}


with ThreadPoolExecutor(8) as ex:
    res = dict(ex.map(one, pairs))
pickle.dump(res, open(out, "wb"))
bad = sum(1 for v in res.values() if v is None)
unk = sum(1 for v in res.values() if v for w in v["ways"] if w[0] is None)
print(out, len(res), "ошибок", bad, "участков без way", unk)
