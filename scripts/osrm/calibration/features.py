"""Маршруты OSRM для всех пар эталона с раскладкой по классам дорог.

python features.py <версия> <osrm_url> [файл эталона] → feat_<версия>.json
Для пары: m, s (время маршрута), cls {класс: метры}, cls_s {класс: секунды езды},
pen_s (штрафы поворотов и светофоров = время маршрута − время езды), inter (перекрёстков).
"""
import json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ver, url = sys.argv[1], sys.argv[2]
pts = {p["id"]: p for p in json.load(open("points.json"))}
# Пары — из файла эталона (по умолчанию первый сеанс gis.jsonl; третий аргумент — другой файл).
ref_file = sys.argv[3] if len(sys.argv) > 3 else "gis.jsonl"
pairs = sorted({(r["src"], r["dst"]) for r in map(json.loads, open(ref_file))})
CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
CENTER = (45.0355, 38.9753)  # lat, lon
ZONES = [(3.0, "core"), (8.0, "city")]  # км от центра; дальше — outer


def zone(lon, lat):
    dy = (lat - CENTER[0]) * 111.2
    dx = (lon - CENTER[1]) * 111.2 * 0.707
    d = (dx * dx + dy * dy) ** 0.5
    for r, z in ZONES:
        if d <= r:
            return z
    return "outer"


def one(pair):
    a, b = pts[pair[0]], pts[pair[1]]
    q = (f"{url}/route/v1/driving/{a['lon']},{a['lat']};{b['lon']},{b['lat']}"
         "?overview=full&geometries=geojson&steps=true&annotations=distance,duration")
    try:
        d = json.load(urllib.request.urlopen(q, timeout=30))
    except Exception as e:
        return pair, {"err": str(e)}
    if d.get("code") != "Ok":
        return pair, {"err": d.get("code")}
    r = d["routes"][0]
    coords = [tuple(round(x, 6) for x in c) for c in r["geometry"]["coordinates"]]
    ann = r["legs"][0]["annotation"]
    seg_m, seg_s = ann["distance"], ann["duration"]
    # Класс участка — у перекрёстка, с которого он начинается (classes выезда).
    marks = {}
    inter = 0
    roads, roads_s, mid_s = {}, {}, {}
    steps = r["legs"][0]["steps"]
    first, last = steps[0].get("name"), steps[-2].get("name") if len(steps) > 1 else None
    for s in steps:
        if s.get("name"):
            roads[s["name"]] = roads.get(s["name"], 0) + s["distance"]
            roads_s[s["name"]] = roads_s.get(s["name"], 0) + s["duration"]
            # Сквозные участки: без улицы начала и улицы конца маршрута (улицы самих адресов).
            if s["name"] not in (first, last):
                mid_s[s["name"]] = mid_s.get(s["name"], 0) + s["duration"]
        for it in s.get("intersections", []):
            inter += 1
            loc = tuple(round(x, 6) for x in it["location"])
            cl = [c for c in it.get("classes", []) if c in CLASSES]
            marks[loc] = cl[0] if cl else "other"
    cur, cls, cls_s, czone = "other", {}, {}, {}
    for i in range(len(seg_m)):
        cur = marks.get(coords[i], cur)
        cls[cur] = cls.get(cur, 0) + seg_m[i]
        cls_s[cur] = cls_s.get(cur, 0) + seg_s[i]
        z = zone((coords[i][0] + coords[i + 1][0]) / 2, (coords[i][1] + coords[i + 1][1]) / 2)
        czone[f"{cur}@{z}"] = czone.get(f"{cur}@{z}", 0) + seg_m[i]
    return pair, {"m": r["distance"], "s": r["duration"], "cls": cls, "cls_s": cls_s, "czone": czone,
                  "pen_s": r["duration"] - sum(seg_s), "inter": inter, "roads": roads, "roads_s": roads_s, "mid_s": mid_s,
                  "snap": [w["distance"] for w in d["waypoints"]]}


with ThreadPoolExecutor(8) as ex:
    res = dict(ex.map(one, pairs))
json.dump({f"{a}|{b}": v for (a, b), v in res.items()}, open(f"feat_{ver}.json", "w"), ensure_ascii=False)
errs = [k for k, v in res.items() if "err" in v]
print(ver, "маршрутов", len(res), "ошибок", len(errs))
