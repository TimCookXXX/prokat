"""Небольшой градиентный бустинг (LAD в логарифмах, веса по диапазонам длины) поверх базовой
лог-линейной формулы. Деревья — JSON {f, t, l, r} / {v}, переносятся в TypeScript."""
import numpy as np


def wmedian(v, w):
    o = np.argsort(v); v, w = v[o], w[o]
    c = np.cumsum(w)
    return v[np.searchsorted(c, c[-1] / 2)]


def build_tree(X, g, res, w, depth, min_leaf, qs):
    """Разбиения — по МНК к g (знак остатка), значения листьев — взвешенная медиана остатка."""
    def node(idx, d):
        if d == 0 or len(idx) < 2 * min_leaf:
            return {"v": float(wmedian(res[idx], w[idx]))}
        best = None
        gi, wi = g[idx], w[idx]
        tot_w, tot_s = wi.sum(), (wi * gi).sum()
        for f in range(X.shape[1]):
            xf = X[idx, f]
            for t in qs[f]:
                m = xf <= t
                nl = m.sum()
                if nl < min_leaf or len(idx) - nl < min_leaf:
                    continue
                wl, sl = wi[m].sum(), (wi[m] * gi[m]).sum()
                wr, sr = tot_w - wl, tot_s - sl
                if wl <= 0 or wr <= 0:
                    continue
                gain = sl * sl / wl + sr * sr / wr
                if best is None or gain > best[0]:
                    best = (gain, f, t)
        if best is None:
            return {"v": float(wmedian(res[idx], w[idx]))}
        _, f, t = best
        m = X[idx, f] <= t
        return {"f": int(f), "t": float(t), "l": node(idx[m], d - 1), "r": node(idx[~m], d - 1)}
    return node(np.arange(len(g)), depth)


def tree_pred(tr, X):
    out = np.empty(len(X))
    for i in range(len(X)):
        n = tr
        while "v" not in n:
            n = n["l"] if X[i, n["f"]] <= n["t"] else n["r"]
        out[i] = n["v"]
    return out


def fit_gbm(X, f0, ly, w, n_trees=100, lr=0.05, depth=2, min_leaf=40, n_q=16, subsample=0.8, seed=0):
    rnd = np.random.RandomState(seed)
    qs = [np.unique(np.quantile(X[:, j], np.linspace(0.05, 0.95, n_q))) for j in range(X.shape[1])]
    f = f0.copy()
    trees = []
    for _ in range(n_trees):
        res = ly - f
        idx = np.where(rnd.rand(len(f)) < subsample)[0]
        tr = build_tree(X[idx], np.sign(res[idx]), res[idx], w[idx], depth, min_leaf, qs)
        _scale(tr, lr)
        f = f + tree_pred(tr, X)
        trees.append(tr)
    return trees


def _scale(n, lr):
    if "v" in n:
        n["v"] *= lr
    else:
        _scale(n["l"], lr); _scale(n["r"], lr)


def gbm_pred(trees, X):
    return sum(tree_pred(t, X) for t in trees) if trees else np.zeros(len(X))
