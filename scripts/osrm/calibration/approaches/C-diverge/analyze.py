"""Участки OSM, связанные с расхождением км OSRM и 2ГИС (только train, day).
python analyze.py <routes.pkl> [--min 3]"""
import json, pickle, sys, collections
import numpy as np
sys.path.insert(0, "/Users/timur/Desktop/sravniprokat/scripts/osrm/calibration")
from evalkit import load_work, pair_part

routes = pickle.load(open(sys.argv[1], "rb"))
MIN = int(sys.argv[sys.argv.index("--min") + 1]) if "--min" in sys.argv else 3
idx = pickle.load(open("approaches/C-diverge/osmindex.pkl", "rb"))
ways, loc = idx["ways"], idx["loc"]
ref, split = load_work()
day = ref["day"]
keys = [k for k in day if pair_part(k, split) == "train" and routes.get(k)]
y = np.array([np.log(day[k]["m"] / routes[k]["m"]) for k in keys])
yt = np.array([np.log(day[k]["s"] / (routes[k]["s"] + 23)) for k in keys])
print("train pairs", len(keys), "log km ratio mean %.3f median %.3f" % (y.mean(), np.median(y)),
      " share OSRM shorter by >10%%: %.2f, longer by >10%%: %.2f" % (np.mean(y > 0.095), np.mean(y < -0.105)))
use = collections.defaultdict(set)
for i, k in enumerate(keys):
    for w, m, s in routes[k]["ways"]:
        if m > 5:
            use[w].add(i)
cand = [w for w, s in use.items() if len(s) >= MIN]
col = {w: j for j, w in enumerate(cand)}
X = np.zeros((len(keys), len(cand)))
for w in cand:
    for i in use[w]:
        X[i, col[w]] = 1
yc = y - np.median(y)
lam = 3.0
coef = np.linalg.solve(X.T @ X + lam * np.eye(len(cand)), X.T @ yc)
def desc(w):
    t, refs = ways[w]
    mid = loc.get(refs[len(refs) // 2])
    return f"{w} {t.get('highway')}/{t.get('service','')} acc={t.get('access','')}{t.get('motor_vehicle','')} surf={t.get('surface','')} «{t.get('name','')}» {mid[0]:.4f},{mid[1]:.4f}"
order = np.argsort(-coef)
print("== участки: OSRM короче 2ГИС (коэф > 0)")
for j in order[:40]:
    w = cand[j]; ii = list(use[w])
    print(f"{coef[j]:+.3f} n={len(ii):3d} meanY={y[ii].mean():+.3f} meanYt={yt[ii].mean():+.3f}  {desc(w)}")
print("== участки: OSRM длиннее")
for j in order[::-1][:15]:
    w = cand[j]; ii = list(use[w])
    print(f"{coef[j]:+.3f} n={len(ii):3d} meanY={y[ii].mean():+.3f}  {desc(w)}")
json.dump({str(cand[j]): [float(coef[j]), len(use[cand[j]]), float(y[list(use[cand[j]])].mean())] for j in range(len(cand))},
          open(sys.argv[1].replace(".pkl", "_coef.json"), "w"))
# по типам участков: доля маршрутов, где тип встречается, и средний Y
def typ(w):
    t = ways[w][0]
    hw = t.get("highway")
    a = t.get("access") or t.get("motor_vehicle") or t.get("motorcar") or ""
    return f"{hw}|{t.get('service','')}|{a}|{'named' if t.get('name') else 'noname'}"
tu = collections.defaultdict(lambda: collections.defaultdict(float))
for i, k in enumerate(keys):
    for w, m, s in routes[k]["ways"]:
        tu[typ(w)][i] += m
print("== типы участков: маршрутов, средний Y у маршрутов с типом (>50 м) vs без")
for tp, d in sorted(tu.items(), key=lambda x: -len(x[1])):
    ii = [i for i, m in d.items() if m > 50]
    if len(ii) < 5: continue
    others = np.setdiff1d(np.arange(len(keys)), ii)
    print(f"{tp:45s} n={len(ii):4d} Y={y[ii].mean():+.3f} (без {y[others].mean():+.3f})  Yt={yt[ii].mean():+.3f} (без {yt[others].mean():+.3f})")
