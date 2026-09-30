"""Поправки скорости для отдельных магистралей поверх откалиброванного профиля.

python fit3.py <версия признаков> [--min-routes 30] [--prev road_factors.json]
Время = f · время_OSRM + Σ_дорога ρ · секунды_на_дороге + β; ρ штрафуются (λ по 5-кратной
перекрёстной проверке). Выход: road_factors_<версия>.json — множитель скорости по названию
дороги (перемножается с уже действующим), и оценка на отложенных парах.
"""
import json, random, sys
from collections import Counter
import numpy as np
from scipy.optimize import lsq_linear

ver = sys.argv[1]
min_routes = int(sys.argv[sys.argv.index("--min-routes") + 1]) if "--min-routes" in sys.argv else 30
prev = json.load(open(sys.argv[sys.argv.index("--prev") + 1])) if "--prev" in sys.argv else {}
gis = {(r["src"], r["dst"]): r for r in map(json.loads, open("gis.jsonl")) if r["label"] == "day" and r["m"] >= 300}
feat = {tuple(k.split("|")): v for k, v in json.load(open(f"feat_{ver}.json")).items()}
keys = sorted(k for k in gis if k in feat and "err" not in feat[k])
# Разбиение по ТОЧКАМ: отложенные точки в подборе не участвуют вообще (у пользователя адрес новый).
points = sorted({p for k in keys for p in k})
test_pts = set(random.Random(7).sample(points, len(points) // 5))
train = [k for k in keys if k[0] not in test_pts and k[1] not in test_pts]
tk = [k for k in keys if k[0] in test_pts or k[1] in test_pts]
tk_both = [k for k in keys if k[0] in test_pts and k[1] in test_pts]
FEAT = "mid_s" if "--through" in sys.argv else "roads_s"
same_road = lambda k: abs(feat[k]["m"] - gis[k]["m"]) / gis[k]["m"] <= 0.25
fit_keys = [k for k in train if same_road(k)]

cnt = Counter(n for k in fit_keys for n in feat[k][FEAT])
ROADS = sorted(n for n, c in cnt.items() if c >= min_routes)


def row(k):
    rs = feat[k][FEAT]
    return [feat[k]["s"], 1.0] + [rs.get(n, 0) for n in ROADS]


def solve(ks, lam):
    A = np.array([row(k) for k in ks], float)
    t = np.array([gis[k]["s"] for k in ks], float)
    w = 1 / t
    R = np.zeros((len(ROADS), A.shape[1]))
    R[:, 2:] = np.eye(len(ROADS)) * np.sqrt(lam)
    Aa = np.vstack([A * w[:, None], R])
    ta = np.concatenate([t * w, np.zeros(len(ROADS))])
    lo = [0.5, -300] + [-0.5] * len(ROADS)   # скорость дороги не больше ×2 …
    hi = [2.0, 300] + [1.0] * len(ROADS)     # … и не меньше ×0,5 от своего класса
    return lsq_linear(Aa, ta, bounds=(lo, hi)).x


def rel(x, ks):
    t = np.array([gis[k]["s"] for k in ks], float)
    return np.abs(np.array([np.dot(row(k), x) for k in ks]) - t) / t


# Перекрёстная проверка тоже по группам точек.
tr_pts = sorted({p for k in fit_keys for p in k})
grp = {p: i % 5 for i, p in enumerate(random.Random(11).sample(tr_pts, len(tr_pts)))}
folds = [[k for k in fit_keys if grp[k[0]] == i or grp[k[1]] == i] for i in range(5)]
fold_train = [[k for k in fit_keys if grp[k[0]] != i and grp[k[1]] != i] for i in range(5)]
best = None
for lam in [0, 0.3, 1, 3, 10, 30, 100, 1e9]:
    e = np.concatenate([rel(solve(fold_train[i], lam), folds[i]) for i in range(5)])
    print(f"  λ={lam:<6g} перекрёстная: средняя {e.mean()*100:.1f}%  медиана {np.median(e)*100:.1f}%")
    if best is None or e.mean() < best[1]:
        best = (lam, e.mean())
lam = best[0]
x = solve(fit_keys, lam)
f, beta, rho = x[0], x[1], x[2:]
e = rel(x, tk)
x0 = solve(fit_keys, 1e9)
e0 = rel(x0, tk)
print(f"признак {FEAT}; дорог с поправкой: {len(ROADS)} (≥{min_routes} маршрутов), λ={lam}; подбор {len(fit_keys)} пар, проверка {len(tk)} пар (оба конца новые: {len(tk_both)})")
print(f"проверка без поправок дорог: медиана {np.median(e0)*100:.1f}%  средняя {e0.mean()*100:.1f}%  90% в {np.percentile(e0,90)*100:.1f}%")
print(f"проверка с поправками:       медиана {np.median(e)*100:.1f}%  средняя {e.mean()*100:.1f}%  90% в {np.percentile(e,90)*100:.1f}%  ≤10%: {np.mean(e<=.1)*100:.0f}%  ≤20%: {np.mean(e<=.2)*100:.0f}%")
eb, eb0 = rel(x, tk_both), rel(x0, tk_both)
print(f"  оба конца новые: без поправок медиана {np.median(eb0)*100:.1f}% средняя {eb0.mean()*100:.1f}%;  с поправками медиана {np.median(eb)*100:.1f}% средняя {eb.mean()*100:.1f}%")
# множитель скорости дороги: её секунды весят (f + ρ)/f от прочих → скорость × f/(f + ρ)
factors = dict(prev)
for n, r in sorted(zip(ROADS, rho), key=lambda z: z[1]):
    k = f / (f + r)
    factors[n] = factors.get(n, 1.0) * k
    if abs(k - 1) > 0.05:
        print(f"  {n:38s} скорость ×{k:.2f}")
json.dump(factors, open(f"road_factors_{ver}.json", "w"), ensure_ascii=False, indent=1)
