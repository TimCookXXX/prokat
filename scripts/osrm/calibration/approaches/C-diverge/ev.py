"""Оценка варианта профиля подхода C на TRAIN (day): сборка → OSRM :5013 → маршруты с узлами → метрики.
from ev import run; r = run(params_dict, "tag")   (cwd data/calibration)"""
import json, os, pickle, subprocess, sys, urllib.request, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
np.seterr(all="ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "../.."))
sys.path.insert(0, HERE)
from evalkit import load_work, pair_part, BUCKETS
from cparams import lua

ROOT = "/Users/timur/Desktop/sravniprokat"
OUT = os.path.join(ROOT, "data/calibration/approaches/C-diverge")
PROFILE = os.path.join(ROOT, "scripts/osrm/calibration/approaches/C-diverge/profile")
PORT, NAME = 5013, "osrm-C"
URL = f"http://127.0.0.1:{PORT}"
REF, SPLIT = load_work()
DAY = REF["day"]
PTS = {p["id"]: p for p in json.load(open(os.path.join(ROOT, "data/calibration/points.json")))}
PAIRS = sorted({(r["src"], r["dst"]) for r in map(json.loads, open(os.path.join(ROOT, "data/calibration/work/train_val.jsonl")))})
TRAIN = [k for k in DAY if pair_part(k, SPLIT) == "train"]
_idx = None


def edge_index():
    global _idx
    if _idx is None:
        _idx = pickle.load(open(os.path.join(OUT, "osmindex.pkl"), "rb"))
    return _idx


def sh(cmd):
    subprocess.run(cmd, shell=True, check=True, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def build(p, ver, profile=PROFILE):
    os.makedirs(os.path.join(OUT, "params"), exist_ok=True)
    pl = os.path.join(OUT, "params", f"{ver}.lua")
    open(pl, "w").write(lua(p))
    json.dump(p, open(os.path.join(OUT, "params", f"{ver}.json"), "w"), ensure_ascii=False, indent=1)
    d = f"data/osrm/builds/C-{ver}"
    subprocess.run(f"docker rm -f {NAME}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sh(f"PROFILE_DIR={profile} LDD={profile}/zones.geojson bash scripts/osrm/build.sh {d} {pl}")
    sh(f"bash scripts/osrm/calibration/serve.sh {d} {PORT} {NAME}")
    return d


def route(pair, url=URL, nodes=True):
    a, b = PTS[pair[0]], PTS[pair[1]]
    q = (f"{url}/route/v1/driving/{a['lon']},{a['lat']};{b['lon']},{b['lat']}"
         f"?overview=false&annotations={'nodes,' if nodes else ''}distance,duration")
    for _ in range(3):
        try:
            d = json.load(urllib.request.urlopen(q, timeout=30)); break
        except Exception:
            time.sleep(0.5)
    r = d["routes"][0]
    out = {"m": r["distance"], "s": r["duration"], "snap": [w["distance"] for w in d["waypoints"]]}
    if nodes:
        edge = edge_index()["edge"]
        ann = r["legs"][0]["annotation"]
        nd, dm, ds = ann["nodes"], ann["distance"], ann["duration"]
        ws = []
        for i in range(len(dm)):
            w = edge.get((nd[i], nd[i + 1])) if i + 1 < len(nd) else None
            if ws and ws[-1][0] == w:
                ws[-1][1] += dm[i]; ws[-1][2] += ds[i]
            else:
                ws.append([w, dm[i], ds[i]])
        out["ways"] = ws
        out["nodes"] = nd
    return pair, out


def routes(pairs=None, nodes=True):
    with ThreadPoolExecutor(8) as ex:
        return dict(ex.map(lambda k: route(k, nodes=nodes), pairs or PAIRS))


def table(url=URL):
    """Как сайт: /table от отправления до всех прибытий. {(s,d): (м, с)}"""
    from collections import defaultdict
    by = defaultdict(set)
    for s, d in PAIRS:
        by[s].add(d)
    out = {}
    for s, ds in by.items():
        ds = sorted(ds)
        coords = ";".join(f"{PTS[i]['lon']:.6f},{PTS[i]['lat']:.6f}" for i in [s] + ds)
        r = json.load(urllib.request.urlopen(f"{url}/table/v1/driving/{coords}?sources=0&annotations=distance,duration", timeout=60))
        for j, t in enumerate(ds):
            out[(s, t)] = (r["distances"][0][j + 1], r["durations"][0][j + 1])
    return out


def km_stats(R, keys):
    y = np.array([np.log(DAY[k]["m"] / R[k]["m"]) for k in keys])
    e = np.abs(np.exp(-y) - 1)  # |osrm-gis|/gis
    return {"km_med": float(np.median(e)), "km_mean": float(e.mean()), "km_p90": float(np.percentile(e, 90)),
            "logabs": float(np.abs(y).mean()), "bias": float(np.median(y))}


def bal(sec, keys, f, b):
    em = np.array([abs(f * sec[k] + b - DAY[k]["s"]) / DAY[k]["s"] for k in keys])
    km = np.array([DAY[k]["m"] / 1000 for k in keys])
    return float(np.mean([em[(km >= lo) & (km < hi)].mean() for lo, hi in BUCKETS])), float(em.mean())


def fit_fb(sec, keys):
    best = None
    for f in np.arange(0.8, 1.6, 0.02):
        for b in range(-60, 241, 10):
            v = bal(sec, keys, f, b)[0]
            if best is None or v < best[0]:
                best = (v, f, b)
    return best


def metrics(R, keys=None, fb=None):
    keys = keys or TRAIN
    out = km_stats(R, keys)
    sec = {k: R[k]["s"] for k in keys}
    out["min_bal_raw"], out["min_mean_raw"] = bal(sec, keys, 1.0, 23)
    v, f, b = fb and (None, *fb) or fit_fb(sec, keys)
    out["min_bal_fit"], out["min_mean_fit"] = bal(sec, keys, f, b)
    out["f"], out["b"] = float(f), float(b)
    return out


def fmt(m):
    return (f"км мед {m['km_med']*100:5.2f}% сред {m['km_mean']*100:5.2f}% p90 {m['km_p90']*100:5.1f}% |log| {m['logabs']:.4f} bias {m['bias']:+.3f}"
            f" | мин bal(1,23) {m['min_bal_raw']*100:5.2f}% bal(fit {m['f']:.2f},{m['b']:.0f}) {m['min_bal_fit']*100:5.2f}%")


def run(p, ver, nodes=True, keep=False):
    d = build(p, ver)
    R = routes(nodes=nodes)
    pickle.dump(R, open(os.path.join(OUT, f"routes_{ver}.pkl"), "wb"))
    m = metrics(R)
    if not keep and ver not in ("v0",):
        subprocess.run(f"rm -rf {ROOT}/{d}/*.osrm.* ", shell=True)  # граф можно пересобрать из params/<ver>.lua
    print(f"[{ver}] {fmt(m)}", flush=True)
    return R, m
