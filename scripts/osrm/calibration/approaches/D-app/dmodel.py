"""Датасет и подборщик формулы приложения (подход D).
Минимизируем прямо метрику: сбалансированную по диапазонам длины среднюю |прогноз/2ГИС − 1|
(гладкое приближение), кросс-валидация — по группам точек train (как fit3.py)."""
import json, math, os, sys
import numpy as np
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
from evalkit import load_work, pair_part, BUCKETS  # noqa
from dfeat import point_info, pair_features, OKRUGS  # noqa


def load(table_file, label="day", with_ref=True):
    ref, split = load_work()
    pts = {p["id"]: p for p in json.load(open("points.json"))}
    info = {k: point_info(p["lat"], p["lon"]) for k, p in pts.items()}
    T = json.load(open(table_file))
    rows = []
    for key, t in T.items():
        a, b = key.split("|")
        if t["s"] is None:
            continue
        f = pair_features(info[a], info[b], t)
        f["key"] = (a, b)
        r = ref[label].get((a, b))
        f["gs"] = r["s"] if r else None
        f["gm"] = r["m"] if r else None
        f["part"] = pair_part((a, b), split)
        rows.append(f)
    return rows, split


def bucket_w(gm_km):
    w = np.zeros(len(gm_km))
    for lo, hi in BUCKETS:
        m = (gm_km >= lo) & (gm_km < hi)
        if m.sum():
            w[m] = 1.0 / m.sum()
    return w / w.sum()


def hinge(v, knots):
    return [np.maximum(0, v - k) for k in knots]


def fit_log(X, y, w, lam, prior=None, pen_mask=None, eps=0.02, theta0=None):
    """log прогноз = X·θ; loss = Σ w·sqrt((exp(Xθ)/y − 1)² + eps²) + lam·Σ(θ−prior)²·mask."""
    n, p = X.shape
    prior = np.zeros(p) if prior is None else prior
    pen_mask = np.ones(p) if pen_mask is None else pen_mask

    def fg(th):
        e = np.exp(X @ th) / y
        r = e - 1
        s = np.sqrt(r * r + eps * eps)
        L = (w * s).sum() + lam * (pen_mask * (th - prior) ** 2).sum()
        g = X.T @ (w * r / s * e) + 2 * lam * pen_mask * (th - prior)
        return L, g
    th = np.zeros(p) if theta0 is None else theta0
    res = minimize(fg, th, jac=True, method="L-BFGS-B", options={"maxiter": 3000})
    return res.x


def rel_score(pred_s, gs, gm_km):
    e = np.abs(pred_s / gs - 1)
    out = {}
    bal = []
    for lo, hi in BUCKETS:
        m = (gm_km >= lo) & (gm_km < hi)
        out[f"{lo}-{hi if hi < 1e8 else ''}"] = float(e[m].mean())
        bal.append(e[m].mean())
    out["bal"] = float(np.mean(bal))
    out["mean"] = float(e.mean())
    out["median"] = float(np.median(e))
    return out


def point_folds(split, k=5, seed=7):
    ids = sorted(p for p, v in split["point"].items() if v == "train")
    rnd = np.random.RandomState(seed)
    perm = rnd.permutation(len(ids))
    return {ids[i]: int(j % k) for j, i in enumerate(perm)}
