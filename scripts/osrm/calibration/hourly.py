"""Почасовая кривая пробок 2ГИС: одни и те же 100 пар (10×10, точки из train) на каждый час буднего дня и
несколько часов выходных → gis_hourly.jsonl. Множитель часа = медиана (время часа / время 13:00 буднего дня).

python hourly.py [пауза_с=30]
"""
import json, os, random, sys, time, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
KEY = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env")) if l.startswith("DGIS_API_KEY="))
pause = float(sys.argv[1]) if len(sys.argv) > 1 else 30
pts = {p["id"]: p for p in json.load(open("points.json"))}
split = json.load(open("split.json"))["point"]
train = sorted(i for i, v in split.items() if v == "train")
ch = random.Random(24).sample(train, 20)
src, dst = ch[:10], ch[10:]
# Среда 30.09 — будний день; суббота 03.10 и воскресенье 04.10. Время МСК = UTC+3.
# Час h МСК среды 30.09: 03–23 → 30.09 (h−3):00Z; 00–02 — ночь на четверг 01.10 → 30.09 (h+21):00Z.
slots = [("wd", h, f"2026-09-30T{h - 3:02d}:00:00Z") for h in range(3, 24)]
slots += [("wd", h, f"2026-09-30T{h + 21:02d}:00:00Z") for h in range(0, 3)]
slots += [("sat", h, f"2026-10-03T{h - 3:02d}:00:00Z") for h in (10, 13, 18)]
slots += [("sun", h, f"2026-10-04T{h - 3:02d}:00:00Z") for h in (10, 13, 18)]
done = set()
if os.path.exists("gis_hourly.jsonl"):
    done = {(r["day"], r["hour"]) for r in map(json.loads, open("gis_hourly.jsonl"))}
out = open("gis_hourly.jsonl", "a")
for day, hour, start in slots:
    if (day, hour) in done:
        continue
    ids = src + dst
    body = {"points": [{"lat": pts[i]["lat"], "lon": pts[i]["lon"]} for i in ids], "sources": list(range(10)),
            "targets": list(range(10, 20)), "transport": "driving", "type": "jam", "start_time": start}
    for attempt in range(10):
        try:
            data = json.load(urllib.request.urlopen(urllib.request.Request(
                f"https://routing.api.2gis.com/get_dist_matrix?key={KEY}&version=2.0", data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"}), timeout=60))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("429, жду минуту", flush=True); time.sleep(60); continue
            print("HTTP", e.code, e.read()[:200]); sys.exit(2)
    else:
        print("429 подряд — останов"); sys.exit(4)
    for r in data["routes"]:
        if r.get("status") == "OK" and r.get("distance"):
            out.write(json.dumps({"day": day, "hour": hour, "start": start, "src": ids[r["source_id"]], "dst": ids[r["target_id"]],
                                  "m": r["distance"], "s": r["duration"]}) + "\n")
    out.flush()
    print(f"{day} {hour:02d}:00 готово", flush=True)
    time.sleep(pause)
print("готово")
