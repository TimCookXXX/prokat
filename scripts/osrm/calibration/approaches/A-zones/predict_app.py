"""Прогноз как на сайте: OSRM /table (distance, duration) + формула приложения из params.json.

python predict_app.py <osrm_url> <params.json> <out.json>
км = km_factor · distance / 1000; минуты = app_seconds(…) / 60 — см. README.md.
"""
import json, math, sys, urllib.request
from collections import defaultdict


CENTER = (45.0355, 38.9753)


def dc(p):
    dy = (p["lat"] - CENTER[0]) * 111.2
    dx = (p["lon"] - CENTER[1]) * 111.2 * 0.707
    return math.hypot(dx, dy)


def crow_m(a, b):
    dy = (a["lat"] - b["lat"]) * 111.2
    dx = (a["lon"] - b["lon"]) * 111.2 * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
    return math.hypot(dx, dy) * 1000


def app_seconds(app, sec, km, crow, ep_d=()):
    """sec, km — из OSRM /table; crow — расстояние по прямой между точками, м;
    ep_d — расстояния концов от центра города, км."""
    t = app.get("f", 1.0) * sec + app["beta0"]
    for c, h in app.get("hinges", {}).items():
        t += h * max(0.0, float(c) - km)
    crow = max(crow, 50.0)
    for name, g in app.get("terms", {}).items():
        if name == "crow":
            t += g * crow
        elif name.startswith("exc_m:"):
            t += g * max(0.0, km * 1000 - float(name[6:]) * crow)
        elif name.startswith("exc_s:"):
            t += g * sec * max(0.0, 1 - float(name[6:]) * crow / max(km * 1000, 1.0))
        elif name.startswith("sh_s:"):
            r = float(name[5:])
            t += g * sec * max(0.0, r - km) / r
        elif name.startswith("ep:"):
            t += g * sum(d <= float(name[3:]) for d in ep_d)
    return max(t, 30.0)


if __name__ == "__main__":
    url, pf, out = sys.argv[1], sys.argv[2], sys.argv[3]
    app = json.load(open(pf))["app"]
    pts = {p["id"]: p for p in json.load(open("points.json"))}
    by_src = defaultdict(set)
    for r in map(json.loads, open("work/train_val.jsonl")):
        by_src[r["src"]].add(r["dst"])
    pred = {}
    for s, dsts in by_src.items():
        dsts = sorted(dsts)
        coords = ";".join(f"{pts[i]['lon']:.6f},{pts[i]['lat']:.6f}" for i in [s] + dsts)
        d = json.load(urllib.request.urlopen(f"{url}/table/v1/driving/{coords}?sources=0&annotations=distance,duration", timeout=60))
        for j, t in enumerate(dsts):
            m, sec = d["distances"][0][j + 1], d["durations"][0][j + 1]
            pred[f"{s}|{t}"] = None if m is None or sec is None else [app.get("km_factor", 1.0) * m / 1000, app_seconds(app, sec, m / 1000, crow_m(pts[s], pts[t]), [dc(pts[s]), dc(pts[t])]) / 60]
    json.dump(pred, open(out, "w"), ensure_ascii=False)
    print(out, len(pred), "пар")
