"""Подбор параметров профиля по эталону 2ГИС с зонами и регуляризацией.

python fit2.py <версия признаков> [--label day] [--out params.lua]

Время пары: t = Σ_{класс,зона} метры · (k_класс + δ_класс,зона) + α · штрафы_OSRM + γ · перекрёстки + β.
δ штрафуются (λ·δ²): скорость в зоне отходит от общей скорости класса, только если данные
это подтверждают. λ выбирается 5-кратной перекрёстной проверкой на обучающих парах;
20% пар отложены и в подборе не участвуют.
"""
import json, random, sys
import numpy as np
from scipy.optimize import lsq_linear

ver = sys.argv[1]
label = sys.argv[sys.argv.index("--label") + 1] if "--label" in sys.argv else "day"
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
ZONES = ["core", "city", "outer"]
NC, NZ = len(CLASSES), len(CLASSES) * len(ZONES)

gis = {(r["src"], r["dst"]): r for r in map(json.loads, open("gis.jsonl")) if r["label"] == label and r["m"] >= 300}
feat = {tuple(k.split("|")): v for k, v in json.load(open(f"feat_{ver}.json")).items()}
keys = sorted(k for k in gis if k in feat and "err" not in feat[k])
rnd = random.Random(2026)
test = set(rnd.sample(keys, len(keys) // 5))
train = [k for k in keys if k not in test]
same_road = lambda k: abs(feat[k]["m"] - gis[k]["m"]) / gis[k]["m"] <= 0.25


def row(k):
    cz = feat[k]["czone"]
    z = [cz.get(f"{c}@{zn}", 0) + (cz.get(f"other@{zn}", 0) if c == "minor" else 0) for c in CLASSES for zn in ZONES]
    return z + [feat[k]["pen_s"], feat[k]["inter"], 1.0]


def class_row(k):
    z = row(k)[:NZ]
    return [sum(z[i * 3:(i + 1) * 3]) for i in range(NC)] + row(k)[NZ:]


# Физически разумные скорости по классу, км/ч: редкое сочетание «класс × зона» не уйдёт в абсурд.
BOUNDS = {"fast": (30, 100), "primary": (15, 80), "secondary": (15, 70), "tertiary": (12, 60), "minor": (10, 50), "service": (5, 35)}
K_LO = [3.6 / BOUNDS[c][1] for c in CLASSES]
K_HI = [3.6 / BOUNDS[c][0] for c in CLASSES]
EXTRA_LO, EXTRA_HI = [0.0, 0.0, -120.0], [10.0, 40.0, 300.0]


def solve_classes(ks):
    A = np.array([class_row(k) for k in ks], float)
    t = np.array([gis[k]["s"] for k in ks], float)
    w = 1 / t
    return lsq_linear(A * w[:, None], t * w, bounds=(K_LO + EXTRA_LO, K_HI + EXTRA_HI)).x


def solve(ks, lam):
    """Скорости класса в зоне; λ тянет их к скорости класса без зон (подобранной на тех же парах)."""
    prior = solve_classes(ks)
    A = np.array([row(k) for k in ks], float)
    t = np.array([gis[k]["s"] for k in ks], float)
    w = 1 / t
    R = np.zeros((NZ, A.shape[1]))
    R[:, :NZ] = np.eye(NZ) * np.sqrt(lam) * 100
    r0 = np.repeat(prior[:NC], len(ZONES)) * np.sqrt(lam) * 100
    Aa, ta = np.vstack([A * w[:, None], R]), np.concatenate([t * w, r0])
    zlo = [v for v in K_LO for _ in ZONES]
    zhi = [v for v in K_HI for _ in ZONES]
    return lsq_linear(Aa, ta, bounds=(zlo + EXTRA_LO, zhi + EXTRA_HI)).x


def predict(x, ks):
    return np.array([np.dot(row(k), x) for k in ks])


def rel_err(x, ks):
    t = np.array([gis[k]["s"] for k in ks], float)
    return np.abs(predict(x, ks) - t) / t


fit_keys = [k for k in train if same_road(k)]
folds = [fit_keys[i::5] for i in range(5)]
best = None
for lam in [0.0, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 10]:
    errs = []
    for i in range(5):
        tr = [k for j, f in enumerate(folds) if j != i for k in f]
        errs.extend(rel_err(solve(tr, lam), folds[i]))
    m = float(np.mean(errs))
    print(f"  λ={lam:<5} перекрёстная проверка: средняя ошибка {m*100:.1f}%  медиана {np.median(errs)*100:.1f}%")
    if best is None or m < best[1]:
        best = (lam, m)
lam = best[0]
x = solve(fit_keys, lam)


def summary(e):
    return (f"медиана {np.median(e)*100:4.1f}%  средняя {e.mean()*100:4.1f}%  90% в {np.percentile(e, 90)*100:4.1f}%"
            f"  ≤10%: {np.mean(e <= .1)*100:3.0f}%  ≤20%: {np.mean(e <= .2)*100:3.0f}%")


tk = sorted(test)
km = np.array([abs(feat[k]["m"] - gis[k]["m"]) / gis[k]["m"] for k in keys])
print(f"признаки {ver}, эталон {label}: пар {len(keys)}, подбор на {len(fit_keys)}, проверка {len(tk)}, λ={lam}")
print(f"КМ   все пары                 медиана {np.median(km)*100:4.1f}%  средняя {km.mean()*100:4.1f}%  90% в {np.percentile(km,90)*100:4.1f}%  ≤5%: {np.mean(km<=.05)*100:3.0f}%  ≤10%: {np.mean(km<=.1)*100:3.0f}%")
print("МИН  время OSRM как есть     ", summary(np.abs(np.array([feat[k]["s"] for k in tk]) - np.array([gis[k]["s"] for k in tk])) / np.array([gis[k]["s"] for k in tk], float)))
print("МИН  модель, подбор          ", summary(rel_err(x, fit_keys)))
print("МИН  модель, проверка        ", summary(rel_err(x, tk)), " ← честная оценка")

speeds = {f"{c}@{zn}": 3.6 / x[i * 3 + j] for i, c in enumerate(CLASSES) for j, zn in enumerate(ZONES)}
xc = solve_classes(fit_keys)
alpha, gamma, beta = x[-3], x[-2], x[-1]
print("скорости км/ч:")
for c in CLASSES:
    print(f"  {c:9s} " + "  ".join(f"{zn}: {speeds[f'{c}@{zn}']:5.1f}" for zn in ZONES) + f"   (класс без зон {3.6 / xc[CLASSES.index(c)]:5.1f})")
print(f"штрафы OSRM ×{alpha:.2f}, за перекрёсток {gamma:.1f} с, постоянная {beta:+.0f} с")
json.dump({"speeds": speeds, "alpha": alpha, "gamma": gamma, "beta": beta, "lambda": lam},
          open(f"fit2_{ver}_{label}.json", "w"), ensure_ascii=False, indent=1)
