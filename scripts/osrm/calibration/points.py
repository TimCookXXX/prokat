"""Точки для калибровки: центры микрорайонов, пригороды, случайные точки на улицах, прокаты из БД."""
import os, json, math, random, re, subprocess, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
OSRM = "http://127.0.0.1:5001"
UA = {"User-Agent": "inrenta/1.0 (calibration)"}
random.seed(42)


def get(url, headers=None):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=20))


def snap(lat, lon):
    """Ближайшая точка на дороге (как адрес на улице)."""
    w = get(f"{OSRM}/nearest/v1/driving/{lon},{lat}?number=1")["waypoints"][0]
    return w["location"][1], w["location"][0], w["distance"]


points = []
src = open(f"{ROOT}/src/lib/compare/geo-data.ts", encoding="utf-8").read()
for name, lat, lon in re.findall(r'name: "([^"]+)", okrug: "[^"]+", lat: ([\d.]+), lon: ([\d.]+)', src):
    points.append({"id": f"m:{name}", "kind": "micro", "lat": float(lat), "lon": float(lon)})

SUBURBS = ["Яблоновский", "Новая Адыгея", "Энем", "Козет", "Старобжегокай", "Российский, Краснодар",
           "Знаменский, Краснодар", "Елизаветинская", "Южный, Динской район", "Лорис", "Индустриальный, Краснодар",
           "Берёзовый, Краснодар", "Колосистый", "Плодородный", "Старокорсунская", "Новотитаровская"]
for s in SUBURBS:
    q = urllib.parse.urlencode({"q": s, "format": "json", "limit": 1, "viewbox": "38.7,45.25,39.35,44.88", "bounded": 1})
    hit = get(f"https://nominatim.openstreetmap.org/search?{q}", UA)
    time.sleep(1.1)
    if hit:
        lat, lon, d = snap(float(hit[0]["lat"]), float(hit[0]["lon"]))
        points.append({"id": f"s:{s.split(',')[0]}", "kind": "suburb", "lat": lat, "lon": lon})
    else:
        print("не найден:", s)

# Случайные точки на улицах возле центров микрорайонов: 0,5–3 км в случайную сторону.
micros = [p for p in points if p["kind"] == "micro"]
for i in range(24):
    c = random.choice(micros)
    r, a = random.uniform(0.5, 3.0), random.uniform(0, 2 * math.pi)
    lat = c["lat"] + r * math.cos(a) / 111.0
    lon = c["lon"] + r * math.sin(a) / (111.0 * math.cos(math.radians(c["lat"])))
    slat, slon, d = snap(lat, lon)
    if d < 400:
        points.append({"id": f"r:{i}", "kind": "random", "lat": slat, "lon": slon})

# Прокаты из dev-БД (реальные адреса с координатами).
rows = subprocess.run(["docker", "exec", "inrenta-dev", "psql", "-U", "app", "-d", "app", "-At", "-F", "|", "-c",
                       "select name, lat, lon from rental_shops where lat is not null"], capture_output=True, text=True).stdout
for line in rows.strip().splitlines():
    name, lat, lon = line.split("|")
    points.append({"id": f"p:{name}", "kind": "shop", "lat": float(lat), "lon": float(lon)})

json.dump(points, open("points.json", "w"), ensure_ascii=False, indent=1)
from collections import Counter
print(len(points), Counter(p["kind"] for p in points))
