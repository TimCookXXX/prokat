"""Граф и маршруты для подхода A-zones.

python pipe.py <версия> <params.json> [--no-probes]
params.json → params.lua + zones.geojson → сборка основного графа и проб (тот же вес
маршрута, но время кодирует признак) → маршруты всех пар эталона → feat_<версия>.json.
Пробы: code — темп = код (класс, зона, съезд, покрытие) каждого участка;
sig_*/inter_*/left_*/right/uturn — время +1 с на признак поворота (светофор, перекрёсток,
сигмоида левого/правого поворота, разворот; *_hi — с участием магистрали).
"""
import json, math, os, subprocess, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../../../.."))
CAL = os.path.join(ROOT, "data/calibration")
OUT = os.path.join(CAL, "approaches/A-zones")
PORT, NAME = 5011, "osrm-A"
URL = f"http://127.0.0.1:{PORT}"
CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
CENTER = (45.0355, 38.9753)
PEN = ["sig_hi", "sig_lo", "inter_hi", "inter_lo", "left_hi", "left_lo", "right", "uturn"]
PROBES = ["code"] + PEN


def zone_names(p):
    return [f"z{i + 1}" for i in range(len(p["rings"]) + 1)]


def circle(r_km, n=96):
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        lat = CENTER[0] + r_km * math.cos(a) / 111.2
        lon = CENTER[1] + r_km * math.sin(a) / (111.2 * math.cos(math.radians(CENTER[0])))
        pts.append([round(lon, 6), round(lat, 6)])
    return pts


def zones_geojson(p):
    names = zone_names(p)
    feats, prev = [], None
    for i, r in enumerate(p["rings"]):
        ring = circle(r)
        coords = [ring] + ([list(reversed(prev))] if prev else [])
        feats.append({"type": "Feature", "properties": {"zone": names[i]}, "geometry": {"type": "Polygon", "coordinates": coords}})
        prev = ring
    return {"type": "FeatureCollection", "features": feats}


def lua_val(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return f"{v:.5g}" if isinstance(v, float) else str(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "{ " + ", ".join(lua_val(x) for x in v) + " }"
    if isinstance(v, dict):
        return "{ " + ", ".join(f"[{json.dumps(k, ensure_ascii=False)}] = {lua_val(x)}" for k, x in sorted(v.items())) + " }"
    raise TypeError(v)


def params_lua(p, probe=None):
    names = zone_names(p)
    lines = ["-- Параметры профиля car.lua (подход A-zones): темп класса дороги в зоне, с/м;",
             "-- штрафы, с; поправки магистралей — множитель скорости. Генерирует pipe.py.", "return {"]
    lines.append("  speeds = { fast = 90, primary = 65, secondary = 55, tertiary = 40, minor = 25, service = 15 },")
    lines.append("  link_factor = 1,")
    lines.append(f"  zones = {lua_val(names)},")
    lines.append(f"  zone_index = {lua_val({z: i + 1 for i, z in enumerate(names)})},")
    lines.append("  zone_pace = {")
    for c in CLASSES:
        lines.append(f"    {c} = {{ " + ", ".join(f"{z} = {p['pace'][c][z]:.5f}" for z in names) + " },")
    lines.append("  },")
    for k in ["link_pace", "bad_surface_pace", "turn_weight_extra"]:
        lines.append(f"  {k} = {float(p.get(k, 0)):.4f},")
    lines.append("  pen = { " + ", ".join(f"{k} = {float(p['pen'][k]):.3f}" for k in PEN) + " },")
    lines.append(f"  rate_factors = {lua_val(p.get('rate_factors', {}))},")
    lines.append(f"  no_start = {lua_val({h: True for h in p.get('no_start', ['service', 'living_street'])})},")
    lines.append(f"  no_start_oneway = {lua_val({h: True for h in p.get('no_start_oneway', [])})},")
    lines.append("  road_factors = {")
    for n, k in sorted(p.get("road_factors", {}).items()):
        lines.append(f"    [{json.dumps(n, ensure_ascii=False)}] = {k:.4f},")
    lines.append("  },")
    if probe:
        lines.append(f"  probe = {json.dumps(probe)},")
    lines.append("}")
    return "\n".join(lines) + "\n"


def sh(cmd, **kw):
    subprocess.run(cmd, shell=True, check=True, cwd=ROOT, **kw)


def build(ver, p, probe=None):
    d = f"data/osrm/builds/A-zones-{ver}" + (f"-{probe}" if probe else "")
    src = os.path.join(OUT, "params")
    os.makedirs(src, exist_ok=True)
    pl = os.path.join(src, f"params_{ver}" + (f"_{probe}" if probe else "") + ".lua")
    open(pl, "w").write(params_lua(p, probe))
    zg = os.path.join(src, f"zones_{ver}.geojson")
    json.dump(zones_geojson(p), open(zg, "w"))
    for attempt in range(3):  # параллельные сборки иногда падают от нехватки памяти
        r = subprocess.run(f"PROFILE_DIR={HERE}/profile LDD={zg} bash scripts/osrm/build.sh {d} {pl}", shell=True,
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        if r.returncode == 0:
            return d
    raise RuntimeError(f"сборка {d}: " + r.stderr[-500:])


def serve(d):
    subprocess.run(f"docker rm -f {NAME}", shell=True, cwd=ROOT, capture_output=True)
    sh(f"docker run -d --name {NAME} -p 127.0.0.1:{PORT}:5000 -v $PWD/{d}:/data:ro "
       f"ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-routed --algorithm mld --max-table-size 1000 /data/krasnodar.osrm",
       stdout=subprocess.DEVNULL)
    for _ in range(120):
        try:
            urllib.request.urlopen(f"{URL}/nearest/v1/driving/38.97,45.03", timeout=2)
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("OSRM не поднялся: " + d)


def pairs():
    return sorted({(r["src"], r["dst"]) for r in map(json.loads, open(os.path.join(CAL, "work/train_val.jsonl")))})


PTS = {p["id"]: p for p in json.load(open(os.path.join(CAL, "points.json")))}


def get(q):
    for i in range(5):
        try:
            return json.load(urllib.request.urlopen(q, timeout=60))
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(q)


def route(pair, full):
    a, b = PTS[pair[0]], PTS[pair[1]]
    extra = "&steps=true" if full else ""
    d = get(f"{URL}/route/v1/driving/{a['lon']},{a['lat']};{b['lon']},{b['lat']}?overview=false&annotations=distance,duration{extra}")
    return d["routes"][0], d["waypoints"]


def main_feats(pair):
    r, wp = route(pair, True)
    ann = r["legs"][0]["annotation"]
    steps = r["legs"][0]["steps"]
    names = [s.get("name") or "" for s in steps]
    first, last = names[0], names[-2] if len(steps) > 1 else None
    mid_s, mid_m, roads_s = {}, {}, {}
    for s, n in zip(steps, names):
        if not n:
            continue
        roads_s[n] = roads_s.get(n, 0) + s["duration"]
        if n not in (first, last):
            mid_s[n] = mid_s.get(n, 0) + s["duration"]
            mid_m[n] = mid_m.get(n, 0) + s["distance"]
    return {"m": r["distance"], "s": r["duration"], "seg_m": ann["distance"], "seg_s": ann["duration"],
            "snap": [w["distance"] for w in wp], "mid_s": mid_s, "mid_m": mid_m, "roads_s": roads_s,
            "first": first, "last": last, "steps_nd": [(n, s["distance"]) for s, n in zip(steps, names)]}


def collect(ver, p, probes=True):
    t0 = time.time()
    todo = [None] + (PROBES if probes else [])
    with ThreadPoolExecutor(5) as ex:
        dirs = dict(zip(todo, ex.map(lambda pr: build(ver, p, pr), todo)))
    ps = pairs()
    serve(dirs[None])
    with ThreadPoolExecutor(8) as ex:
        feat = dict(zip(ps, ex.map(main_feats, ps)))
    for pr in todo[1:]:
        serve(dirs[pr])
        with ThreadPoolExecutor(8) as ex:
            res = list(ex.map(lambda k: route(k, False)[0], ps))
        for k, r in zip(ps, res):
            f = feat[k]
            if abs(r["distance"] - f["m"]) > 1:
                f.setdefault("mismatch", []).append(pr)
            if pr == "code":
                ann = r["legs"][0]["annotation"]
                cm = {}
                for dm, ds in zip(ann["distance"], ann["duration"]):
                    if dm <= 0:
                        continue
                    c = int(round(ds / dm))
                    cm[c] = cm.get(c, 0) + dm
                f["code_m"] = {str(c): v for c, v in cm.items()}
                # код каждого участка — для скоростей магистралей по названию
                # сквозные магистрали: метры по кодам на каждой улице (без первой и последней)
                codes = [int(round(ds / dm)) if dm > 0 else 0 for dm, ds in zip(ann["distance"], ann["duration"])]
                rc, ra, i, acc = {}, {}, 0, 0.0
                for n, sd in f.pop("steps_nd"):
                    end = acc + sd
                    while i < len(codes) and acc < end - 0.5:
                        if n:
                            for dd in ([rc, ra] if n not in (f["first"], f["last"]) else [ra]):
                                d = dd.setdefault(n, {})
                                d[str(codes[i])] = d.get(str(codes[i]), 0) + ann["distance"][i]
                        acc += ann["distance"][i]
                        i += 1
                f["mid_code_m"] = rc
                f["road_code_m"] = ra  # все участки улицы, как применяет профиль
            else:
                f[pr] = r["duration"] - f["s"]
    if "--keep" not in sys.argv:
        for d in dirs.values():
            subprocess.run(f"rm -rf {d}", shell=True, cwd=ROOT) if d != dirs[None] else None
    out = {f"{a}|{b}": v for (a, b), v in feat.items()}
    json.dump(out, open(os.path.join(OUT, f"feat_{ver}.json"), "w"), ensure_ascii=False)
    mm = sum(1 for v in feat.values() if v.get("mismatch"))
    print(f"{ver}: {len(feat)} маршрутов, несовпадений проб {mm}, {time.time() - t0:.0f} с", flush=True)
    return dirs[None]


if __name__ == "__main__":
    ver, pf = sys.argv[1], sys.argv[2]
    p = json.load(open(pf))
    collect(ver, p, "--no-probes" not in sys.argv)
