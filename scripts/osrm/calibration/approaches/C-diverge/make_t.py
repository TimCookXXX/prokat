"""Параметры времени по train поверх варианта выбора пути: python make_t.py <probe tag> <route params.json> <out tag>
[nmin=10 λrf=0.02 λ=0.001] → approaches/C-diverge/params_<out>.json (с beta)."""
import sys, os, json, numpy as np, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fit_time import Model, point_folds
from cv_time import cv
tag, rp, out = sys.argv[1], sys.argv[2], sys.argv[3]
nmin, lr, lam = (int(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])) if len(sys.argv) > 6 else (10, 0.02, 0.001)
base = json.load(open(rp))
M0 = Model(tag, sig=base["signal_penalty"])
names = sorted(n for n, c in M0.name_pairs.items() if c >= nmin)
M = Model(tag, rf_names=names, sig=base["signal_penalty"])
b, mean, med = cv(M, lam, lam_rf=lr)
folds, train = point_folds()
th = M.fit(train, lam=lam, lam_rf=lr)
p = M.to_params(th, base)
p["road_factors"] = {n: round(k, 4) for n, k in p["road_factors"].items() if abs(np.log(k)) > 0.01}
p["notes"] = {"probe": tag, "nmin": nmin, "lam_rf": lr, "lam": lam, "cv_bal": b, "cv_mean": mean, "cv_median": med,
              "train_bal": M.score(th, train)[0]}
json.dump(p, open(f"approaches/C-diverge/params_{out}.json", "w"), ensure_ascii=False, indent=1)
print(out, "CV bal %.2f%% mean %.2f%% median %.2f%% | train bal %.2f%% | β %.1f | улиц с поправкой %d" % (
    b * 100, mean * 100, med * 100, p["notes"]["train_bal"] * 100, p["beta"], len(p["road_factors"])))
