"""Повторяемость 2ГИС: блоки плана запрашиваются несколько раз подряд → gis_recheck.jsonl (run = номер прогона).

python recheck.py <id блоков через запятую> <прогонов> [пауза_с=60]
"""
import json, os, sys, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
KEY = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env")) if l.startswith("DGIS_API_KEY="))
ids, runs = [int(x) for x in sys.argv[1].split(",")], int(sys.argv[2])
pause = float(sys.argv[3]) if len(sys.argv) > 3 else 60
plan = {b["id"]: b for b in json.load(open("plan.json"))}
pts = {p["id"]: p for p in json.load(open("points.json"))}
out = open("gis_recheck.jsonl", "a")
for run in range(runs):
    for bid in ids:
        b = plan[bid]
        pid = b["src"] + b["dst"]
        body = {"points": [{"lat": pts[i]["lat"], "lon": pts[i]["lon"]} for i in pid],
                "sources": list(range(10)), "targets": list(range(10, 20)), "transport": "driving", "type": "jam", "start_time": b["start"]}
        data = json.load(urllib.request.urlopen(urllib.request.Request(
            f"https://routing.api.2gis.com/get_dist_matrix?key={KEY}&version=2.0", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"}), timeout=60))
        for r in data["routes"]:
            if r.get("status") == "OK":
                out.write(json.dumps({"run": run, "at": time.strftime("%H:%M:%S"), "src": pid[r["source_id"]], "dst": pid[r["target_id"]],
                                      "m": r["distance"], "s": r["duration"]}, ensure_ascii=False) + "\n")
        out.flush()
        print(f"прогон {run} блок {bid} {time.strftime('%H:%M:%S')}", flush=True)
        time.sleep(30)
    if run + 1 < runs:
        time.sleep(pause)
