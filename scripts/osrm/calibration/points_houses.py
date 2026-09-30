"""Дополнительные точки-адреса: N случайных домов в радиусе R км от центра каждого микрорайона.

python points_houses.py [N=4] [R=1.3] → дописывает в points.json (kind=house, id h:<микрорайон>:<i>).
Дом — обратный геокодер OpenStreetMap (Nominatim, zoom 18, не чаще 1 запроса в секунду):
точка адреса, как у настоящего пользователя, а не середина дороги.
"""
import json, math, os, random, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
UA = {"User-Agent": "inrenta/1.0 (calibration)"}
N = int(sys.argv[1]) if len(sys.argv) > 1 else 4
R = float(sys.argv[2]) if len(sys.argv) > 2 else 1.3
rnd = random.Random(20260929)

points = json.load(open("points.json"))
have = {p["id"] for p in points}
src = open(os.path.join(ROOT, "src/lib/compare/geo-data.ts"), encoding="utf-8").read()
micros = [(n, float(a), float(b)) for n, a, b in re.findall(r'name: "([^"]+)", okrug: "[^"]+", lat: ([\d.]+), lon: ([\d.]+)', src)]

added = 0
for name, clat, clon in micros:
    got, tries = 0, 0
    while got < N and tries < N * 4:
        tries += 1
        pid = f"h:{name}:{got}"
        if pid in have:
            got += 1
            continue
        r, a = R * math.sqrt(rnd.random()), rnd.uniform(0, 2 * math.pi)
        lat = clat + r * math.cos(a) / 111.2
        lon = clon + r * math.sin(a) / (111.2 * math.cos(math.radians(clat)))
        q = urllib.parse.urlencode({"lat": lat, "lon": lon, "format": "json", "zoom": 18, "addressdetails": 1})
        try:
            hit = json.load(urllib.request.urlopen(urllib.request.Request(f"https://nominatim.openstreetmap.org/reverse?{q}", headers=UA), timeout=20))
        except Exception as e:
            print("ошибка", e); time.sleep(3); continue
        finally:
            time.sleep(1.1)
        addr = hit.get("address", {})
        if not addr.get("house_number") or not addr.get("road"):
            continue
        hlat, hlon = float(hit["lat"]), float(hit["lon"])
        if math.hypot((hlat - lat) * 111.2, (hlon - lon) * 78.6) > 0.3:
            continue
        points.append({"id": pid, "kind": "house", "lat": hlat, "lon": hlon, "label": f"{addr['road']}, {addr['house_number']}"})
        have.add(pid)
        got += 1
        added += 1
    print(f"{name}: {got}", flush=True)

json.dump(points, open("points.json", "w"), ensure_ascii=False, indent=1)
print("добавлено", added, "всего", len(points))
