"""Линии пути 2ГИС (маршрутизатор, как в приложении) для пар из списка — для поиска дорог,
которыми OSRM ездит, а навигатор нет.

python routes2gis2.py <pairs.json> <start_time> [пауза_с=1.5] → дописывает в gis_routes2.jsonl
Запись: src, dst, m, s, coords [[lon, lat], …], streets [(название, метры), …].
"""
import json, os, re, sys, time, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
KEY = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env")) if l.startswith("DGIS_API_KEY="))
P = {p["id"]: p for p in json.load(open("points.json"))}
pairs, start = json.load(open(sys.argv[1])), sys.argv[2]
pause = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5
done = set()
if os.path.exists("gis_routes2.jsonl"):
    done = {(r["src"], r["dst"]) for r in map(json.loads, open("gis_routes2.jsonl"))}
out = open("gis_routes2.jsonl", "a")
n = 0
for s, t in pairs:
    if (s, t) in done:
        continue
    a, b = P[s], P[t]
    body = {"points": [{"type": "stop", "lat": a["lat"], "lon": a["lon"]}, {"type": "stop", "lat": b["lat"], "lon": b["lon"]}],
            "transport": "driving", "route_mode": "fastest", "traffic_mode": "jam", "start_time": start,
            "output": "detailed", "locale": "ru"}
    d = None
    for attempt in range(10):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(
                f"https://routing.api.2gis.com/routing/7.0.0/global?key={KEY}", data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"}), timeout=30))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:  # ограничение частоты — ждём и повторяем
                print("429, жду минуту", flush=True); time.sleep(60); continue
            print("HTTP", e.code, e.read()[:200], "— останов", flush=True); sys.exit(2)
        except Exception as e:
            print(e, "— останов", flush=True); sys.exit(3)
    if d is None:
        print("429 десять раз подряд — останов", flush=True); sys.exit(4)
    if d.get("status") != "OK" or not d.get("result"):
        continue
    r = d["result"][0]
    coords, streets = [], []
    for m in r["maneuvers"]:
        op = m.get("outcoming_path") or {}
        name = (op.get("names") or [""])[0]
        if op.get("distance"):
            streets.append([name, op["distance"]])
        for g in op.get("geometry", []):
            for x, y in re.findall(r"(-?\d+\.\d+) (-?\d+\.\d+)", g.get("selection", "")):
                pt = [float(x), float(y)]
                if not coords or coords[-1] != pt:
                    coords.append(pt)
    out.write(json.dumps({"src": s, "dst": t, "start": start, "m": r["total_distance"], "s": r["total_duration"],
                          "coords": coords, "streets": streets}, ensure_ascii=False) + "\n")
    out.flush()
    n += 1
    if n % 25 == 0:
        print("маршрутов", n, flush=True)
    time.sleep(pause)
print("готово, новых", n)
