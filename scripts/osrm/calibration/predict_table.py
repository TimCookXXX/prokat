"""Прогноз для пар эталона так же, как считает сайт: OSRM /table от точки отправления до точек
прибытия, минуты = (f · секунды + β) / 60.

python predict_table.py <osrm_url> <out.json> [f=1] [β=23] [--ref work/train_val.jsonl]
→ {"src|dst": [км, минуты]} для всех пар файла эталона (все метки).
"""
import json, sys, urllib.request
from collections import defaultdict

url, out = sys.argv[1], sys.argv[2]
f = float(sys.argv[3]) if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else 1.0
beta = float(sys.argv[4]) if len(sys.argv) > 4 and not sys.argv[4].startswith("--") else 23.0
ref = sys.argv[sys.argv.index("--ref") + 1] if "--ref" in sys.argv else "work/train_val.jsonl"
pts = {p["id"]: p for p in json.load(open("points.json"))}
by_src = defaultdict(set)
for r in map(json.loads, open(ref)):
    by_src[r["src"]].add(r["dst"])

pred = {}
for s, dsts in by_src.items():
    dsts = sorted(dsts)
    coords = ";".join(f"{pts[i]['lon']:.6f},{pts[i]['lat']:.6f}" for i in [s] + dsts)
    d = json.load(urllib.request.urlopen(f"{url}/table/v1/driving/{coords}?sources=0&annotations=distance,duration", timeout=60))
    for j, t in enumerate(dsts):
        m, sec = d["distances"][0][j + 1], d["durations"][0][j + 1]
        pred[f"{s}|{t}"] = None if m is None or sec is None else [m / 1000, (f * sec + beta) / 60]
json.dump(pred, open(out, "w"), ensure_ascii=False)
print(out, len(pred), "пар")
