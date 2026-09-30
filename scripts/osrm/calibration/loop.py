"""Итерации «граф → маршруты → подбор»: модель времени встраивается в профиль OSRM.

python loop.py <первая версия> <итераций>
Версия n: params_n.json → сборка data/osrm/builds/vn → признаки feat_vn → fit2 → params_{n+1}.json.
Главная метрика — время, которое OSRM выдаёт сам (+ постоянная β), на отложенных парах.
"""
import os, json, random, subprocess, sys
import numpy as np
from params_lua import lua

HERE = os.path.dirname(os.path.abspath(__file__))

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
PY = sys.executable
CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
ZONES = ["core", "city", "outer"]
start, n_iter = int(sys.argv[1]), int(sys.argv[2])


def sh(cmd, cwd=ROOT):
    subprocess.run(cmd, shell=True, check=True, cwd=cwd)


gis = {(r["src"], r["dst"]): r for r in map(json.loads, open("gis.jsonl")) if r["label"] == "day" and r["m"] >= 300}
keys = sorted(gis)
test = sorted(set(random.Random(2026).sample(keys, len(keys) // 5)))


def evaluate(ver, beta):
    feat = {tuple(k.split("|")): v for k, v in json.load(open(f"feat_{ver}.json")).items()}
    ks = [k for k in test if k in feat and "err" not in feat[k]]
    t = np.array([gis[k]["s"] for k in ks], float)
    e = np.abs(np.array([feat[k]["s"] + beta for k in ks]) - t) / t
    allk = [k for k in keys if k in feat and "err" not in feat[k]]
    km = np.array([abs(feat[k]["m"] - gis[k]["m"]) / gis[k]["m"] for k in allk])
    return (f"МИН (проверка) медиана {np.median(e)*100:4.1f}% средняя {e.mean()*100:4.1f}% 90% в {np.percentile(e,90)*100:4.1f}% ≤10%: {np.mean(e<=.1)*100:3.0f}% ≤20%: {np.mean(e<=.2)*100:3.0f}%"
            f" | КМ медиана {np.median(km)*100:4.1f}% 90% в {np.percentile(km,90)*100:4.1f}% ≤5%: {np.mean(km<=.05)*100:3.0f}% ≤10%: {np.mean(km<=.1)*100:3.0f}%")


p = json.load(open(f"params_{start}.json"))
for n in range(start, start + n_iter):
    ver = f"v{n}"
    open(f"params_{n}.lua", "w").write(lua(p))
    sh(f"bash scripts/osrm/build.sh data/osrm/builds/{ver} {os.path.abspath(f'params_{n}.lua')} > /dev/null")
    sh(f"bash scripts/osrm/calibration/serve.sh data/osrm/builds/{ver} > /dev/null")
    sh(f"{PY} {HERE}/features.py {ver} http://127.0.0.1:5002 > /dev/null", cwd=".")
    print(f"== {ver}: {evaluate(ver, p.get('beta', 0))}", flush=True)
    sh(f"{PY} {HERE}/fit2.py {ver} 2>/dev/null | tail -12", cwd=".")
    fit = json.load(open(f"fit2_{ver}_day.json"))
    a, g = fit["alpha"], fit["gamma"]
    nxt = {
        "zone_speeds": {c: {z: fit["speeds"][f"{c}@{z}"] for z in ZONES} for c in CLASSES},
        "link_factor": p["link_factor"],
        "turn_penalty": p["turn_penalty"] * a,
        "signal_penalty": p["signal_penalty"] * a,
        "u_turn_penalty": p["u_turn_penalty"] * a,
        "intersection_penalty": p["intersection_penalty"] * a + g,
        "beta": fit["beta"],
    }
    json.dump(nxt, open(f"params_{n + 1}.json", "w"), ensure_ascii=False, indent=1)
    p = nxt
