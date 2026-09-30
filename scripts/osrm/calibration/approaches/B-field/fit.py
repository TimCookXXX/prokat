"""Подбор поля скоростей по маршрутам текущего графа (только train; λ — перекрёстной проверкой по точкам).

Модель: T_i = Σ_класс c_k · Σ_участок b · q(x) + α · pen_i + γ · inter_i + β,  минимизируется
средняя |относительная ошибка| с весом диапазонов длины (как min_balanced), IRLS; регуляризация —
λs · Σ_соседи (q_a − q_b)² + λr · Σ (q − 1)².
"""
import numpy as np
from scipy.optimize import lsq_linear
from scipy import sparse

from bf import BUCKETS, CLASSES, bilinear, field_at, balanced

NC = len(CLASSES)


class Design:
    def __init__(self, seg, day, keys, p_cur, G, groups=None, lam_g=0.0):
        """groups: класс → номер поля (None — одно поле на все классы); lam_g — штраф разницы полей."""
        self.keys = keys
        self.G = G
        self.groups = groups or [0] * NC
        ng = max(self.groups) + 1
        n1 = G["nx"] * G["ny"]
        nn = n1 * ng
        self.nn, self.n1, self.ng = nn, n1, ng
        self.y = np.array([day[k]["s"] for k in keys], float)
        self.km = np.array([day[k]["m"] / 1000 for k in keys])
        self.pen = np.array([seg[k]["pen_s"] for k in keys])
        self.inter = np.array([seg[k]["inter"] for k in keys], float)
        self.osrm_s = np.array([seg[k]["s"] for k in keys])
        rows, cols, vals, cl = [], [], [], []
        for i, k in enumerate(keys):
            S = np.array(seg[k]["seg"], float)
            if len(S) == 0:
                continue
            qc = field_at(p_cur, S[:, 0], S[:, 1], S[:, 4])
            b = S[:, 3] / qc
            idx, w = bilinear(G, S[:, 0], S[:, 1])
            rows.append(np.repeat(i, idx.size))
            cols.append((idx + n1 * np.array(self.groups)[S[:, 4].astype(int)][:, None]).ravel())
            vals.append((w * b[:, None]).ravel())
            cl.append(np.repeat(S[:, 4].astype(int), 4))
        rows, cols, vals, cl = map(np.concatenate, (rows, cols, vals, cl))
        n = len(keys)
        self.W = [sparse.csr_matrix((vals[cl == c], (rows[cl == c], cols[cl == c])), shape=(n, nn)) for c in range(NC)]
        wb = np.zeros(n)
        for lo, hi in BUCKETS:
            m = (self.km >= lo) & (self.km < hi)
            if m.any():
                wb[m] = n / (len(BUCKETS) * m.sum())
        self.wb = wb
        # Рёбра сетки (соседи по горизонтали и вертикали) для гладкости.
        nx, ny = G["nx"], G["ny"]
        e = [(j * nx + i, j * nx + i + 1) for j in range(ny) for i in range(nx - 1)]
        e += [(j * nx + i, (j + 1) * nx + i) for j in range(ny - 1) for i in range(nx)]
        D = sparse.lil_matrix((len(e) * ng + (n1 * (ng - 1) if lam_g else 0), nn))
        r = 0
        for g in range(ng):
            for a, b in e:
                D[r, g * n1 + a], D[r, g * n1 + b] = 1, -1
                r += 1
        # разница полей групп (тот же узел) — с весом sqrt(lam_g / lam_s) задаётся через масштаб строк ниже
        self.n_edge_rows = r
        if lam_g:
            for g in range(1, ng):
                for a in range(n1):
                    D[r, a], D[r, g * n1 + a] = 1, -1
                    r += 1
        self.lam_g = lam_g
        self.D = D.tocsr()

    def predict(self, x, rows=None):
        c, q, a, g, beta = x
        W = self.W if rows is None else [w[rows] for w in self.W]
        pen = self.pen if rows is None else self.pen[rows]
        inter = self.inter if rows is None else self.inter[rows]
        return sum(c[k] * (W[k] @ q) for k in range(NC)) + a * pen + g * inter + beta


def fit(D, rows, lam_s, lam_r, x0=None, rounds=8, fix_field=False, beta_bounds=(-60, 240), q_bounds=(0.3, 3.0)):
    rows = np.asarray(rows)
    y, wb = D.y[rows], D.wb[rows]
    W = [w[rows] for w in D.W]
    pen, inter = D.pen[rows], D.inter[rows]
    nn = D.nn
    c = np.ones(NC) if x0 is None else x0[0].copy()
    q = np.ones(nn) if x0 is None else x0[1].copy()
    a, g, beta = (1.0, 0.0, 23.0) if x0 is None else x0[2:]
    irls = np.ones(len(rows))
    for it in range(rounds):
        for part in ("c", "q"):
            if part == "q" and fix_field:
                continue
            sw = np.sqrt(wb * irls) / y
            if part == "c":
                A = np.column_stack([W[k] @ q for k in range(NC)] + [pen, inter, np.ones(len(rows))])
                lo = [0.2] * NC + [0.0, -10.0, beta_bounds[0]]
                hi = [4.0] * NC + [4.0, 40.0, beta_bounds[1]]
                sol = lsq_linear(A * sw[:, None], y * sw, bounds=(lo, hi), method="bvls" if A.shape[1] < 20 else "trf")
                c, (a, g, beta) = sol.x[:NC], sol.x[NC:]
            else:
                Aq = sparse.csr_matrix(sum(sparse.diags(sw) @ (W[k] * c[k]) for k in range(NC)))
                extra = sparse.csr_matrix(np.column_stack([pen, inter, np.ones(len(rows))]) * sw[:, None])
                A = sparse.hstack([Aq, extra])
                scale = np.full(D.D.shape[0], np.sqrt(lam_s))
                scale[D.n_edge_rows:] = np.sqrt(D.lam_g)
                R1 = sparse.hstack([sparse.diags(scale) @ D.D, sparse.csr_matrix((D.D.shape[0], 3))])
                R2 = sparse.hstack([sparse.identity(nn) * np.sqrt(lam_r), sparse.csr_matrix((nn, 3))])
                AA = sparse.vstack([A, R1, R2]).tocsr()
                bb = np.concatenate([y * sw, np.zeros(D.D.shape[0]), np.full(nn, np.sqrt(lam_r))])
                lo = [q_bounds[0]] * nn + [0.0, -10.0, beta_bounds[0]]
                hi = [q_bounds[1]] * nn + [4.0, 40.0, beta_bounds[1]]
                sol = lsq_linear(AA, bb, bounds=(lo, hi), method="trf", lsmr_tol="auto", max_iter=200)
                q, (a, g, beta) = sol.x[:nn], sol.x[nn:]
        pred = sum(c[k] * (W[k] @ q) for k in range(NC)) + a * pen + g * inter + beta
        irls = 1 / np.maximum(np.abs(pred - y) / y, 0.03)
    return (c, q, a, g, beta)


def cv(D, keys_train, folds, lam_s, lam_r, **kw):
    """Перекрёстная проверка по группам точек: подбор без точек группы, оценка на парах с ними."""
    idx = {k: i for i, k in enumerate(D.keys)}
    preds, ys, kms = [], [], []
    for f in folds:
        tr = [idx[k] for k in keys_train if k[0] not in f and k[1] not in f]
        te = [idx[k] for k in keys_train if k[0] in f or k[1] in f]
        x = fit(D, tr, lam_s, lam_r, **kw)
        preds.append(D.predict(x, np.array(te)))
        ys.append(D.y[te]); kms.append(D.km[te])
    p, y, km = map(np.concatenate, (preds, ys, kms))
    b, e = balanced(p, y, km)
    return b, float(e.mean())
