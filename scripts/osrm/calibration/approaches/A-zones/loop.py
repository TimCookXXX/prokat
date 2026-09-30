"""Итерации «граф → маршруты → подбор» (подход A-zones).

python loop.py <имя> <старт params.json> <итераций> [аргументы fit.py…]
Версии <имя>1, <имя>2, …: params → граф и пробы → признаки → fit → следующий params.
После каждой — прогноз как на сайте (/table + формула) и оценка на train.
"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
name, start, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
DAMP = float(sys.argv[sys.argv.index("--damp") + 1]) if "--damp" in sys.argv else 0.0
if "--damp" in sys.argv:
    i = sys.argv.index("--damp"); del sys.argv[i:i + 2]
extra = " ".join(sys.argv[4:])


def damp(prev_f, next_f, a):
    """Затухание: следующий шаг = a·прежние + (1−a)·подобранные (множители улиц — в логарифмах)."""
    import math
    p, q = json.load(open(prev_f)), json.load(open(next_f))
    mix = lambda x, y: a * x + (1 - a) * y
    for c in q["pace"]:
        for z in q["pace"][c]:
            q["pace"][c][z] = mix(p["pace"][c][z], q["pace"][c][z])
    for k in ["link_pace", "bad_surface_pace"]:
        q[k] = mix(p[k], q[k])
    for k in q["pen"]:
        q["pen"][k] = mix(p["pen"][k], q["pen"][k])
    q["app"]["beta0"] = mix(p["app"]["beta0"], q["app"]["beta0"])
    for d in ["hinges", "terms"]:
        for k in q["app"][d]:
            q["app"][d][k] = mix(p["app"].get(d, {}).get(k, 0.0), q["app"][d][k])
    rf = {}
    for r in set(p.get("road_factors", {})) | set(q.get("road_factors", {})):
        rf[r] = math.exp(mix(math.log(p.get("road_factors", {}).get(r, 1.0)), math.log(q.get("road_factors", {}).get(r, 1.0))))
    q["road_factors"] = {r: k for r, k in rf.items() if abs(k - 1) > 0.005}
    json.dump(q, open(next_f, "w"), ensure_ascii=False, indent=1)
P = "approaches/A-zones/params"
cur = start
for i in range(1, n + 1):
    ver = f"{name}{i}"
    subprocess.run(f"{PY} {HERE}/pipe.py {ver} {cur}", shell=True, check=True)
    if i > 1 or "app" in json.load(open(cur)):
        subprocess.run(f"{PY} {HERE}/predict_app.py http://127.0.0.1:5011 {cur} approaches/A-zones/pred_{ver}.json >/dev/null && "
                       f"{PY} {HERE}/../../score_val.py approaches/A-zones/pred_{ver}.json --part train | head -1", shell=True, check=True)
    nxt = f"{P}/{name}{i + 1}.json"
    subprocess.run(f"{PY} {HERE}/fit.py {ver} {cur} {nxt} {extra} 2>/dev/null | tail -9", shell=True, check=True)
    if DAMP:
        damp(cur, nxt, DAMP)
    cur = nxt
