"""Маршруты OSRM для всех пар эталона с геометрией по участкам (для поля скоростей).

python segfeat.py <версия> <osrm_url> [файл эталона=work/train_val.jsonl] → seg_<версия>.json (в cwd)
Для пары: m, s (маршрут OSRM), pen_s (штрафы поворотов/светофоров = s − Σ езды), inter (перекрёстков
с числом дорог > 2), snap (метры до дороги у концов), seg: [[lon, lat, метры, сек, класс], …] — участки
маршрута, склеенные до ~150 м внутри одного класса (координата — середина куска).
"""
import json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ver, url = sys.argv[1], sys.argv[2]
ref_file = sys.argv[3] if len(sys.argv) > 3 else "work/train_val.jsonl"
pts = {p["id"]: p for p in json.load(open("points.json"))}
pairs = sorted({(r["src"], r["dst"]) for r in map(json.loads, open(ref_file))})
CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
CI = {c: i for i, c in enumerate(CLASSES)}
CHUNK = 150.0


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
    coords = r["geometry"]["coordinates"]
    ann = r["legs"][0]["annotation"]
    seg_m, seg_s = ann["distance"], ann["duration"]
    marks, inter = {}, 0
    for s in r["legs"][0]["steps"]:
        for it in s.get("intersections", []):
            if len(it.get("bearings", [])) > 2:
                inter += 1
            loc = tuple(round(x, 6) for x in it["location"])
            cl = [c for c in it.get("classes", []) if c in CI]
            marks[loc] = CI[cl[0]] if cl else CI["minor"]
    cur = CI["minor"]
    out, acc = [], None  # acc: [Σ lon·m, Σ lat·m, m, s, класс]
    for i in range(len(seg_m)):
        cur = marks.get(tuple(round(x, 6) for x in coords[i]), cur)
        lon = (coords[i][0] + coords[i + 1][0]) / 2
        lat = (coords[i][1] + coords[i + 1][1]) / 2
        m, s = seg_m[i], seg_s[i]
        if acc is None or acc[4] != cur or acc[2] >= CHUNK:
            if acc is not None and acc[2] > 0:
                out.append([round(acc[0] / acc[2], 6), round(acc[1] / acc[2], 6), round(acc[2], 1), round(acc[3], 2), acc[4]])
            acc = [0.0, 0.0, 0.0, 0.0, cur]
        acc[0] += lon * m; acc[1] += lat * m; acc[2] += m; acc[3] += s
    if acc is not None and acc[2] > 0:
        out.append([round(acc[0] / acc[2], 6), round(acc[1] / acc[2], 6), round(acc[2], 1), round(acc[3], 2), acc[4]])
    return pair, {"m": r["distance"], "s": r["duration"], "pen_s": r["duration"] - sum(seg_s), "inter": inter,
                  "snap": [w["distance"] for w in d["waypoints"]], "seg": out}


with ThreadPoolExecutor(8) as ex:
    res = dict(ex.map(one, pairs))
json.dump({f"{a}|{b}": v for (a, b), v in res.items()}, open(f"seg_{ver}.json", "w"))
print(ver, "маршрутов", len(res), "ошибок", sum("err" in v for v in res.values()))
