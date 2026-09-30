"""Прогноз итоговой модели F (граф B + формула приложения) ровно так, как считает сайт:
один запрос OSRM /table на точку отправления (sources=0, annotations=distance,duration, привязка
по умолчанию), затем км = метры/1000, минуты = (f·секунды + β)/60 из f_formula.json (f=1, β=48,75 с).
Все метки времени (day/morning/evening/night) — как дневное.

python predict.py <osrm_url> <pairs.jsonl> <out.json> [--points points.json] [--formula f_formula.json]
pairs.jsonl — строки {"src": id, "dst": id, ...} (id из points.json); cwd обычно data/calibration.
→ {"src|dst": [км, минуты]} (null, если OSRM не нашёл путь).
"""
import json, os, sys, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
url, pairs_file, out = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
pts = {p["id"]: p for p in json.load(open(arg("--points", "points.json")))}
F = json.load(open(arg("--formula", os.path.join(HERE, "f_formula.json"))))


def minutes(dur_s):
    return (F["f"] * dur_s + F["beta_s"]) / 60


by_src = defaultdict(set)
for line in open(pairs_file):
    if line.strip():
        r = json.loads(line)
        by_src[r["src"]].add(r["dst"])
extra = F.get("osrm_extra", "")
pred = {}
for s, dsts in by_src.items():
    dsts = sorted(dsts)
    coords = ";".join(f"{pts[i]['lon']:.6f},{pts[i]['lat']:.6f}" for i in [s] + dsts)
    d = json.load(urllib.request.urlopen(
        f"{url}/table/v1/driving/{coords}?sources=0&annotations=distance,duration{extra}", timeout=60))
    for j, t in enumerate(dsts):
        m, sec = d["distances"][0][j + 1], d["durations"][0][j + 1]
        pred[f"{s}|{t}"] = None if m is None or sec is None else [m / 1000, minutes(sec)]
json.dump(pred, open(out, "w"), ensure_ascii=False)
print(out, len(pred), "пар")
