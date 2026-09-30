"""Подбор выбора пути (route_speeds, route_turn, pref, snap) по км на TRAIN: покоординатный спуск.
python opt_route.py <tag> [start.json]  (cwd data/calibration) → approaches/C-diverge/route_<tag>.json"""
import sys, json, copy, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import ev

tag = sys.argv[1]
base = json.load(open("approaches/C-diverge/params_v0.json"))
K = {  # ручки: (значение, тип) — mul: множитель ×/÷ шаг, bool, add: +/− шаг
    "rs.fast": 90, "rs.primary": 65, "rs.secondary": 55, "rs.tertiary": 40, "rs.minor": 25, "rs.service": 15,
    "rt.turn_penalty": 16.0, "rt.signal_penalty": 4.26, "rt.intersection_penalty": 5.61, "rt.to_minor": 0.0,
    "pref.unpaved": 1.0, "pref.noname": 1.0, "pref.restricted": 1.0, "pref.parking_aisle": 1.0,
    "snap.service": True, "snap.living_street": True, "snap.parking_aisle": True, "snap.driveway": True,
    "snap.restricted": True, "snap.unpaved": True,
}
if len(sys.argv) > 2:
    K.update(json.load(open(sys.argv[2]))["knobs"])


def params(k):
    p = copy.deepcopy(base)
    Z = lambda v: {"core": v, "city": v, "outer": v}
    p["route_speeds"] = {c: Z(k[f"rs.{c}"]) for c in ["fast", "primary", "secondary", "tertiary", "minor", "service"]}
    p["route_turn"] = {x: k[f"rt.{x}"] for x in ["turn_penalty", "signal_penalty", "u_turn_penalty", "intersection_penalty", "to_minor"] if f"rt.{x}" in k}
    p["route_turn"].setdefault("u_turn_penalty", base["u_turn_penalty"])
    p["pref"] = {"unpaved": k["pref.unpaved"], "noname": k["pref.noname"], "restricted": k["pref.restricted"],
                 "service_kind": {"parking_aisle": k["pref.parking_aisle"]}}
    p["snap"] = {x.split(".")[1]: v for x, v in k.items() if x.startswith("snap.")}
    return p


def objective(m):
    return m["logabs"]


cache = {}
def evaluate(k, name):
    key = json.dumps(k, sort_keys=True)
    if key not in cache:
        R, m = ev.run(params(k), f"{tag}-{name}")
        cache[key] = m
    return cache[key]


cur = dict(K)
best_m = evaluate(cur, "start")
best = objective(best_m)
log = open(f"approaches/C-diverge/route_{tag}.log", "a")
for rnd in range(3):
    improved = False
    for name, v in list(cur.items()):
        if isinstance(v, bool):
            trials = [not v]
        elif name.startswith("rt.") and v == 0:
            trials = [10.0, 30.0]
        elif name.startswith("rt."):
            trials = [v * 0.6, v * 1.6, 0.0]
        elif name.startswith("pref."):
            trials = [v * 0.6, min(v * 1.5, 3)]
        else:
            trials = [v * 0.85, v * 1.18]
        for t in trials:
            k = dict(cur); k[name] = round(t, 3) if not isinstance(t, bool) else t
            m = evaluate(k, f"r{rnd}")
            o = objective(m)
            msg = f"r{rnd} {name}={k[name]} → {o:.4f} (лучшее {best:.4f}) {ev.fmt(m)}"
            print(msg, flush=True); log.write(msg + "\n"); log.flush()
            if o < best - 0.0005:
                best, best_m, cur = o, m, k
                improved = True
    json.dump({"knobs": cur, "metrics": best_m}, open(f"approaches/C-diverge/route_{tag}.json", "w"), ensure_ascii=False, indent=1)
    if not improved:
        break
print("ИТОГ", cur, ev.fmt(best_m))
