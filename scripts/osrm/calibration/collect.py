"""Эталон 2ГИС: матрица «откуда × куда» с прогнозом пробок на заданное время.

python collect.py <метка> <start_time RFC3339> <блоков> [размер=12] [seed]
Результат дописывается в gis.jsonl (одна строка — одна пара).
"""
import json, os, random, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))

KEY = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env")) if l.startswith("DGIS_API_KEY="))
label, start, blocks = sys.argv[1], sys.argv[2], int(sys.argv[3])
size = int(sys.argv[4]) if len(sys.argv) > 4 else 12
random.seed(int(sys.argv[5]) if len(sys.argv) > 5 else hash(label) % 1000)

points = json.load(open("points.json"))
done = set()
if os.path.exists("gis.jsonl"):
    for l in open("gis.jsonl"):
        r = json.loads(l)
        done.add((r["label"], r["src"], r["dst"]))

out = open("gis.jsonl", "a")
for b in range(blocks):
    chosen = random.sample(range(len(points)), 2 * size)
    src, dst = chosen[:size], chosen[size:]
    pts = [points[i] for i in src + dst]
    body = {
        "points": [{"lat": p["lat"], "lon": p["lon"]} for p in pts],
        "sources": list(range(size)), "targets": list(range(size, 2 * size)),
        "transport": "driving", "type": "jam", "start_time": start,
    }
    req = urllib.request.Request(
        f"https://routing.api.2gis.com/get_dist_matrix?key={KEY}&version=2.0",
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        data = json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read()[:300]); break
    n = 0
    for r in data.get("routes", []):
        s, t = pts[r["source_id"]]["id"], pts[r["target_id"]]["id"]
        if (label, s, t) in done or r.get("status") != "OK":
            continue
        done.add((label, s, t))
        out.write(json.dumps({"label": label, "src": s, "dst": t, "m": r["distance"], "s": r["duration"]}, ensure_ascii=False) + "\n")
        n += 1
    bad = [r.get("status") for r in data.get("routes", []) if r.get("status") != "OK"]
    print(f"блок {b + 1}: пар {len(data.get('routes', []))}, записано {n}, не OK {len(bad)} {set(bad) or ''}", data.get("message") or "")
out.close()
