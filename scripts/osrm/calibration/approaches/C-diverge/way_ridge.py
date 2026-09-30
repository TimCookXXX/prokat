"""Участки, связанные с «OSRM короче 2ГИС»: ридж log(км 2ГИС/км OSRM) на индикаторы участков
с поправкой на точки (эффекты начала/конца). Только переданные пары (train или фолд).

candidates(routes, keys, ...) → [(way, coef, n, n_points, meanY)]"""
import collections
import numpy as np
np.seterr(all="ignore")
from fit_time import DAY


def candidates(R, keys, min_n=4, min_points=3, lam=2.0, lam_pt=1.0, min_m=20):
    y = np.array([np.log(DAY[k]["m"] / R[k]["m"]) for k in keys])
    y = np.clip(y, -1, 1)
    use = collections.defaultdict(set)
    for i, k in enumerate(keys):
        for w, m, s in R[k]["ways"]:
            if m > min_m and w is not None:
                use[w].add(i)
    cand = [w for w, s in use.items() if len(s) >= min_n]
    pts = sorted({p for k in keys for p in k})
    pc = {p: j for j, p in enumerate(pts)}
    nw, npnt = len(cand), len(pts)
    X = np.zeros((len(keys), nw + 2 * npnt + 1))
    for j, w in enumerate(cand):
        for i in use[w]:
            X[i, j] = 1
    for i, k in enumerate(keys):
        X[i, nw + pc[k[0]]] = 1
        X[i, nw + npnt + pc[k[1]]] = 1
        X[i, -1] = 1
    D = np.concatenate([np.full(nw, lam), np.full(2 * npnt, lam_pt), [1e-6]])
    coef = np.linalg.solve(X.T @ X + np.diag(D), X.T @ y)
    out = []
    for j, w in enumerate(cand):
        ii = sorted(use[w])
        npts = len({p for i in ii for p in keys[i]})
        # сколько разных концов «с другой стороны» — участок не только у одной точки
        ends = collections.Counter(p for i in ii for p in keys[i])
        top = ends.most_common(1)[0][1]
        spread = len(ii) - top  # маршрутов без самой частой точки
        out.append((w, float(coef[j]), len(ii), spread, float(y[ii].mean())))
    out.sort(key=lambda r: -r[1])
    return out
