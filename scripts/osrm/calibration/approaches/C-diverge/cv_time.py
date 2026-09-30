"""Перекрёстная проверка подбора времени (группы точек обучения). python cv_time.py <probe tag> [rf_min]"""
import sys, os, json, numpy as np, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fit_time import Model, point_folds, CLASSES, ZONES, DAY
tag = sys.argv[1] if len(sys.argv) > 1 else "r1"
folds, train = point_folds()
base = json.load(open("approaches/C-diverge/params_r1.json"))


def cv(M, lam, lam_rf=1.0, loss="soft_l1", f_scale=0.15):
    allp, allt, allkm = [], [], []
    for tr, te in folds:
        th = M.fit(tr, lam=lam, lam_rf=lam_rf, loss=loss, f_scale=f_scale)
        idx = np.array([M.row[k] for k in te])
        allp += list(M.predict(th, idx)); allt += list(M.t[idx]); allkm += list(M.km[idx])
    p, t, km = map(np.array, (allp, allt, allkm))
    e = np.abs(p - t) / t
    from evalkit import BUCKETS
    bal = np.mean([e[(km >= lo) & (km < hi)].mean() for lo, hi in BUCKETS])
    return bal, e.mean(), np.median(e)


if __name__ == "__main__":
  M0 = Model(tag, sig=base["signal_penalty"])
  for lam in [0.001, 0.01, 0.1, 1.0]:
      print(f"без поправок улиц λ={lam}: CV bal {cv(M0, lam)[0]*100:.2f}%", flush=True)
  for loss, fs in [("linear", 1), ("soft_l1", 0.3), ("soft_l1", 0.08)]:
      print(f"loss={loss},{fs} λ=0.01: CV bal {cv(M0, 0.01, loss=loss, f_scale=fs)[0]*100:.2f}%", flush=True)


def cv_pred(M, lam, lam_rf=1.0):
    out = {}
    for tr, te in folds:
        th = M.fit(tr, lam=lam, lam_rf=lam_rf)
        idx = np.array([M.row[k] for k in te])
        for k, v in zip(te, M.predict(th, idx)):
            out.setdefault(k, []).append(v)
    return {k: np.mean(v) for k, v in out.items()}
