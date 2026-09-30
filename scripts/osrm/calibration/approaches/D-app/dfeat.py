"""Признаки пары «откуда → куда», доступные сайту: OSRM /table + геометрия двух точек.
Все функции переносятся в TypeScript один к одному (см. README.md, app_formula.json)."""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CAL = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, CAL)
DATA = os.path.abspath(os.path.join(HERE, "../../../../../data/calibration/approaches/D-app"))

CENTER = (45.0355, 38.9753)  # lat, lon — как в features.py / zones.geojson
KX = 111.2 * math.cos(math.radians(45.0355))  # км на градус долготы
KY = 111.2
OKRUGS = ["zapadnyy", "tsentralnyy", "karasunskiy", "prikubanskiy"]
_bounds = json.load(open(os.path.join(DATA, "okrug_bounds.json")))
_micro = json.load(open(os.path.join(DATA, "micro.json")))


def xy(lat, lon):
    return (lon - CENTER[1]) * KX, (lat - CENTER[0]) * KY


def okrug_of(lat, lon):
    for slug, lines in _bounds.items():
        inside = False
        for line in lines:
            for i in range(1, len(line)):
                x1, y1 = line[i - 1]
                x2, y2 = line[i]
                if (y1 > lat) != (y2 > lat) and x1 + (lat - y1) * (x2 - x1) / (y2 - y1) > lon:
                    inside = not inside
        if inside:
            return slug
    return None


def south_bank(lat, lon):
    """Левый берег Кубани (Адыгея: Яблоновский, Новая Адыгея, Энем, Козет, Старобжегокай):
    вне границ города, южнее 45.045 и между 38.85 и 39.20 в.д."""
    return okrug_of(lat, lon) is None and lat < 45.045 and 38.85 < lon < 39.20


def point_info(lat, lon):
    x, y = xy(lat, lon)
    r = math.hypot(x, y)
    ok = okrug_of(lat, lon)
    return {"x": x, "y": y, "r": r, "okrug": ok, "south": south_bank(lat, lon)}


def pair_features(a, b, t):
    """a, b: point_info; t: {"m": OSRM метры, "s": OSRM секунды, "snap_src", "snap_dst"} из /table."""
    d = math.hypot(a["x"] - b["x"], a["y"] - b["y"])  # км по прямой
    km = t["m"] / 1000
    # Ближайшее к центру расстояние отрезка a-b (идёт ли поездка через центр)
    ax, ay, bx, by = a["x"], a["y"], b["x"], b["y"]
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    u = 0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
    rmin = math.hypot(ax + u * dx, ay + u * dy)
    return {
        "km": km, "sec": t["s"], "d": d, "detour": km / max(d, 0.2),
        "ra": a["r"], "rb": b["r"], "rmin": rmin, "rmax": max(a["r"], b["r"]),
        "snap_a": t["snap_src"], "snap_b": t["snap_dst"],
        "okr_a": a["okrug"], "okr_b": b["okrug"],
        "cross": a["south"] != b["south"],
        "same_okrug": a["okrug"] is not None and a["okrug"] == b["okrug"],
        "speed": km / max(t["s"], 1) * 3600,
    }
