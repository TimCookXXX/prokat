"""Подход B — «поле скоростей»: общие функции (параметры → params.lua, сборка графа, признаки, подбор).

Запуск из data/calibration. Время маршрута OSRM в модели:
  T = Σ_участок b · c[класс] · q(x) + α · штрафы + γ · перекрёстки + β,
где b — время участка в текущем графе без текущего поля (b = s / q_тек(x)), c — поправка скорости
класса, q(x) — поле множителей времени (билинейно по узлам сетки), β — постоянная приложения (сек).
"""
import json, math, os, random, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../../../.."))
CAL = os.path.join(ROOT, "data/calibration")
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
from evalkit import BUCKETS, load_work, pair_part, score  # noqa: E402

PREFIX = "B-field"
PORT, CONTAINER = 5012, "osrm-B"
URL = f"http://127.0.0.1:{PORT}"
PY = sys.executable
CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
BBOX = (38.75, 44.93, 39.30, 45.22)  # lon0, lat0, lon1, lat1
KM_LAT, KM_LON = 111.2, 111.2 * 0.707


def grid(step_km):
    dlon, dlat = step_km / KM_LON, step_km / KM_LAT
    nx = int(math.ceil((BBOX[2] - BBOX[0]) / dlon)) + 1
    ny = int(math.ceil((BBOX[3] - BBOX[1]) / dlat)) + 1
    return {"lon0": BBOX[0], "lat0": BBOX[1], "dlon": dlon, "dlat": dlat, "nx": nx, "ny": ny}


def bilinear(G, lon, lat):
    """Индексы 4 узлов и веса для массивов координат → (idx[n,4], w[n,4])."""
    x = np.clip((np.asarray(lon) - G["lon0"]) / G["dlon"], 0, G["nx"] - 1)
    y = np.clip((np.asarray(lat) - G["lat0"]) / G["dlat"], 0, G["ny"] - 1)
    i = np.minimum(np.floor(x).astype(int), G["nx"] - 2)
    j = np.minimum(np.floor(y).astype(int), G["ny"] - 2)
    fx, fy = x - i, y - j
    b = j * G["nx"] + i
    idx = np.stack([b, b + 1, b + G["nx"], b + G["nx"] + 1], 1)
    w = np.stack([(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], 1)
    return idx, w


def field_at(p, lon, lat, cls=None):
    if not p.get("field"):
        return np.ones(len(lon))
    F = p["field"]
    idx, w = bilinear(F, lon, lat)
    q = np.asarray(F["q"])
    out = (q[idx] * w).sum(1)
    if F.get("q2") and cls is not None:
        q2 = np.asarray(F["q2"])
        g2 = np.asarray(F["groups"])[np.asarray(cls, int)] == 1
        out = np.where(g2, (q2[idx] * w).sum(1), out)
    return out


def lua(p):
    sp = ", ".join(f"{c} = {p['speeds'][c]:.3f}" for c in CLASSES)
    if p.get("route_speeds"):  # скорость выбора маршрута → множитель веса к скорости класса
        p["rate_factors"] = {c: p["route_speeds"][c] / p["speeds"][c] for c in CLASSES}
    rf = ", ".join(f"{c} = {p['rate_factors'][c]:.4f}" for c in CLASSES) if p.get("rate_factors") else ""
    out = ["-- Параметры профиля car.lua (подход B «поле скоростей»), подобраны по эталону 2ГИС 13:00.",
           "return {",
           f"  speeds = {{ {sp} }},",
           f"  link_factor = {p['link_factor']},",
           f"  turn_penalty = {p['turn_penalty']:.3f},",
           f"  signal_penalty = {p['signal_penalty']:.3f},",
           f"  u_turn_penalty = {p['u_turn_penalty']:.3f},",
           f"  intersection_penalty = {p['intersection_penalty']:.3f},",
           f"  turn_weight_extra = {p.get('turn_weight_extra', 0):.3f},",
           f"  rate_factors = {{ {rf} }},"]
    if p.get("zone_speeds"):
        zs = ",\n    ".join(f"{c} = {{ " + ", ".join(f"{z} = {v:.2f}" for z, v in p['zone_speeds'][c].items()) + " }" for c in CLASSES)
        out.append(f"  zone_speeds = {{\n    {zs}\n  }},")
    if p.get("road_factors"):
        out.append("  road_factors = {")
        out += [f'    ["{n}"] = {k:.3f},' for n, k in sorted(p["road_factors"].items())]
        out.append("  },")
    if p.get("field"):
        F = p["field"]
        out.append(f"  field = {{\n    lon0 = {F['lon0']}, lat0 = {F['lat0']}, dlon = {F['dlon']:.6f}, dlat = {F['dlat']:.6f}, nx = {F['nx']}, ny = {F['ny']},")
        if F.get("q2"):
            out.append("    group = { " + ", ".join(f"{c} = {g + 1}" for c, g in zip(CLASSES, F["groups"])) + " },")
        for name in ("q", "q2"):
            if not F.get(name):
                continue
            out.append(f"    {name} = {{  -- по строкам с юга на север, в строке с запада на восток")
            for j in range(F["ny"]):
                out.append("      " + ", ".join(f"{v:.3f}" for v in F[name][j * F["nx"]:(j + 1) * F["nx"]]) + ",")
            out.append("    },")
        out.append("  },")
    if p.get("route_turn"):
        T = p["route_turn"]
        out.append(f"  route_turn = {{ turn = {T['turn']:.3f}, signal = {T['signal']:.3f}, u_turn = {T['u_turn']:.3f}, intersection = {T['intersection']:.3f} }},")
    if p.get("unpaved_route_factor"):
        out.append(f"  unpaved_route_factor = {p['unpaved_route_factor']:.3f},")
    if p.get("field_in_route"):
        out.append("  field_in_route = true,")
    sts = p.get("snap_to_service", False)
    out.append(f"  snap_to_service = {'true' if sts is True else ('false' if sts is False else repr(sts).replace(chr(39), chr(34)))},")
    if "snap_to_fast" in p:
        out.append(f"  snap_to_fast = {'true' if p['snap_to_fast'] else 'false'},")
    out += ["  use_maxspeed = false,", "}", ""]
    return "\n".join(out)


def sh(cmd, cwd=ROOT, quiet=True):
    subprocess.run(cmd + (" > /dev/null 2>&1" if quiet else ""), shell=True, check=True, cwd=cwd)


def build_and_route(ver, p, profile_dir=None, zones=None):
    """params → граф data/osrm/builds/B-field-<ver> → OSRM на порту → seg_B-field-<ver>.json."""
    profile_dir = profile_dir or os.path.join(HERE, "profile")
    zones = zones or os.path.join(profile_dir, "zones.geojson")
    pl = os.path.join(CAL, f"approaches/{PREFIX}/params_{ver}.lua")
    open(pl, "w").write(lua(p))
    json.dump(p, open(pl.replace(".lua", ".json"), "w"), ensure_ascii=False)
    b = f"data/osrm/builds/{PREFIX}-{ver}"
    sh(f"PROFILE_DIR={profile_dir} LDD={zones} bash scripts/osrm/build.sh {b} {pl}")
    sh(f"bash scripts/osrm/calibration/serve.sh {b} {PORT} {CONTAINER}")
    sh(f"{PY} {HERE}/segfeat.py {PREFIX}-{ver} {URL}", cwd=CAL)
    return load_seg(ver)


def load_seg(ver):
    return {tuple(k.split("|")): v for k, v in json.load(open(os.path.join(CAL, f"seg_{PREFIX}-{ver}.json"))).items()}


def data():
    os.chdir(CAL)
    ref, split = load_work()
    return ref["day"], split


def km_score(seg, day, keys):
    e = np.array([abs(seg[k]["m"] - day[k]["m"]) / day[k]["m"] for k in keys if k in seg and "err" not in seg[k]])
    return float(np.median(e)), float(np.mean(e)), float(np.mean(np.minimum(e, 0.5)))


def balanced(pred_s, true_s, km):
    e = np.abs(pred_s - true_s) / true_s
    return float(np.mean([e[(km >= lo) & (km < hi)].mean() for lo, hi in BUCKETS if ((km >= lo) & (km < hi)).any()])), e


def point_folds(split, n=5, seed=7):
    pts = sorted(p for p, v in split["point"].items() if v == "train")
    random.Random(seed).shuffle(pts)
    return [set(pts[i::n]) for i in range(n)]


def default_params():
    """Стартовые: общие скорости классов без зон (км/ч), штрафы рабочего профиля."""
    return {"speeds": {"fast": 55, "primary": 30, "secondary": 26, "tertiary": 26, "minor": 22, "service": 15},
            "link_factor": 0.5, "turn_penalty": 15.99, "signal_penalty": 4.26, "u_turn_penalty": 42.64,
            "intersection_penalty": 5.61, "turn_weight_extra": 0.0,
            "route_speeds": {"fast": 55, "primary": 30, "secondary": 26, "tertiary": 26, "minor": 22, "service": 15},
            "route_turn": {"turn": 15.99, "signal": 4.26, "u_turn": 42.64, "intersection": 5.61},
            "beta": 23.0}
