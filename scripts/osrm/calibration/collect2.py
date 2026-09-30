"""Сбор эталона 2ГИС по plan.json: блок за блоком, с паузой, останов на первой ошибке.

python collect2.py [пауза_с=3] → дописывает в gis2.jsonl (label, src, dst, m, s, block).
Повторный запуск продолжает с первого несобранного блока.
"""
import json, os, sys, time, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
KEY = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env")) if l.startswith("DGIS_API_KEY="))
pause = float(sys.argv[1]) if len(sys.argv) > 1 else 3
plan = json.load(open("plan.json"))
pts = {p["id"]: p for p in json.load(open("points.json"))}
done = set()
if os.path.exists("gis2.jsonl"):
    done = {json.loads(l)["block"] for l in open("gis2.jsonl")}

out = open("gis2.jsonl", "a")
for b in plan:
    if b["id"] in done:
        continue
    ids = b["src"] + b["dst"]
    body = {"points": [{"lat": pts[i]["lat"], "lon": pts[i]["lon"]} for i in ids],
            "sources": list(range(len(b["src"]))), "targets": list(range(len(b["src"]), len(ids))),
            "transport": "driving", "type": "jam", "start_time": b["start"]}
    req = urllib.request.Request(f"https://routing.api.2gis.com/get_dist_matrix?key={KEY}&version=2.0",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        data = json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        print(f"блок {b['id']} ({b['kind']}): HTTP {e.code} {e.read()[:200]!r} — останов", flush=True)
        sys.exit(2)
    except Exception as e:
        print(f"блок {b['id']}: {e} — останов", flush=True)
        sys.exit(3)
    ok = 0
    for r in data.get("routes", []):
        if r.get("status") != "OK" or r.get("distance") is None:
            continue
        out.write(json.dumps({"label": b["label"], "src": ids[r["source_id"]], "dst": ids[r["target_id"]],
                              "m": r["distance"], "s": r["duration"], "block": b["id"], "kind": b["kind"]}, ensure_ascii=False) + "\n")
        ok += 1
    out.flush()
    print(f"блок {b['id']:2d} {b['kind']:16s} {b['label']:8s} пар OK {ok}", flush=True)
    time.sleep(pause)
print("готово")
