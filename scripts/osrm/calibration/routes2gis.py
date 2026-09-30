"""Маршрутизатор 2ГИС (как в приложении) для выбранных пар: км, минуты и улицы.

python routes2gis.py <файл-списка-пар.json> <start_time> → дописывает в gis_routes.jsonl
"""
import json, os, sys, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))

KEY = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env")) if l.startswith("DGIS_API_KEY="))
P = {p["id"]: p for p in json.load(open("points.json"))}
pairs = json.load(open(sys.argv[1]))
start = sys.argv[2]
done = set()
if os.path.exists("gis_routes.jsonl"):
    done = {(r["src"], r["dst"], r["start"]) for r in map(json.loads, open("gis_routes.jsonl"))}
out = open("gis_routes.jsonl", "a")
for s, t in pairs:
    if (s, t, start) in done:
        continue
    a, b = P[s], P[t]
    body = {"points": [{"type": "stop", "lat": a["lat"], "lon": a["lon"]}, {"type": "stop", "lat": b["lat"], "lon": b["lon"]}],
            "transport": "driving", "route_mode": "fastest", "traffic_mode": "jam", "start_time": start,
            "output": "detailed", "locale": "ru"}
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(
            f"https://routing.api.2gis.com/routing/7.0.0/global?key={KEY}", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"}), timeout=30))
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read()[:200]); break
    if d.get("status") != "OK" or not d.get("result"):
        print("нет маршрута", s, t, d.get("message")); continue
    r = d["result"][0]
    streets = [((m.get("outcoming_path") or {}).get("names") or [""])[0] for m in r["maneuvers"]]
    geom = []
    for m in r["maneuvers"]:
        for g in (m.get("outcoming_path") or {}).get("geometry", []):
            geom.append(g.get("selection", ""))
    out.write(json.dumps({"src": s, "dst": t, "start": start, "m": r["total_distance"], "s": r["total_duration"],
                          "streets": streets, "geom": geom}, ensure_ascii=False) + "\n")
    out.flush()
    time.sleep(0.2)
out.close()
print("готово", sum(1 for _ in open("gis_routes.jsonl")))
