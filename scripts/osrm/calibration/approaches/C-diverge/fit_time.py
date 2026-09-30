"""Подбор скоростей класс × зона, штрафов и поправок магистралей по точной раскладке маршрутов (probe_<tag>.pkl).
Маршруты фиксированы (выбор пути — отдельные веса), поэтому время OSRM считается здесь без пересборок.

from fit_time import Model; M = Model("tag"); th = M.fit(keys, lam=...); M.predict(th, keys)"""
import os, sys, json, pickle, collections
import numpy as np
from scipy.optimize import least_squares
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../.."))
from evalkit import load_work, pair_part, BUCKETS

CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
ZONES = ["core", "city", "outer"]
SURF = {"cement": 80, "compacted": 80, "fine_gravel": 80, "paving_stones": 60, "metal": 60, "bricks": 60, "grass": 40, "wood": 40,
        "sett": 40, "grass_paver": 40, "gravel": 40, "unpaved": 40, "ground": 40, "dirt": 40, "pebblestone": 40, "tartan": 40,
        "cobblestone": 30, "clay": 30, "earth": 20, "stone": 20, "rocky": 20, "sand": 20, "mud": 10}
TRACK = {"grade1": 60, "grade2": 40, "grade3": 30, "grade4": 25, "grade5": 20}
SMOOTH = {"intermediate": 80, "bad": 40, "very_bad": 20, "horrible": 10, "very_horrible": 5}
from probe import CLASS
BOUNDS = {"fast": (30, 110), "primary": (15, 80), "secondary": (15, 70), "tertiary": (12, 60), "minor": (10, 50), "service": (5, 35)}
REF, SPLIT = load_work()
DAY = REF["day"]


def cap_of(t):
    c = 1e9
    for tab, key in ((SURF, "surface"), (TRACK, "tracktype"), (SMOOTH, "smoothness")):
        if t.get(key) in tab:
            c = min(c, tab[t[key]])
    return c


class Model:
    def __init__(self, tag, rf_names=None, rf_min_pairs=15, sig=4.26):
        self.sig = sig  # длительность светофора фиксирована (входит в вес выбора пути)
        self.P = pickle.load(open(f"approaches/C-diverge/probe_{tag}.pkl", "rb"))
        idx = pickle.load(open("approaches/C-diverge/osmindex.pkl", "rb"))
        ways = idx["ways"]
        self.keys_all = [k for k in self.P if k in DAY]
        # признаки: (класс, зона, link, cap, имя)
        feats = {}
        rows = []
        name_pairs = collections.Counter()
        for k in self.keys_all:
            agg = collections.defaultdict(float)
            names = set()
            for (w, z), m in self.P[k]["segs"].items():
                t = ways[w][0]
                hw = t["highway"]
                nm = t.get("name")
                agg[(CLASS[hw], z, hw.endswith("_link"), cap_of(t), nm)] += m
                if nm:
                    names.add(nm)
            name_pairs.update(names)
            rows.append(agg)
        self.name_pairs = name_pairs
        self.rf_names = rf_names if rf_names is not None else []
        for agg in rows:
            for key in agg:
                kk = key[:4] + ((key[4] if key[4] in self.rf_names else None),)
                feats.setdefault(kk, len(feats))
        self.fkeys = list(feats)
        self.M = np.zeros((len(self.keys_all), len(feats)))
        for i, agg in enumerate(rows):
            for key, m in agg.items():
                kk = key[:4] + ((key[4] if key[4] in self.rf_names else None),)
                self.M[i, feats[kk]] += m
        self.X = np.array([[self.P[k]["other_s"], self.P[k]["n_sig"], self.P[k]["n_inter"], self.P[k]["s_ang"], self.P[k]["n_u"]] for k in self.keys_all])
        self.t = np.array([DAY[k]["s"] for k in self.keys_all], float)
        self.km = np.array([DAY[k]["m"] / 1000 for k in self.keys_all])
        self.row = {k: i for i, k in enumerate(self.keys_all)}
        self.fc = np.array([CLASSES.index(f[0]) * 3 + ZONES.index(f[1]) for f in self.fkeys])
        self.flink = np.array([f[2] for f in self.fkeys], float)
        self.fcap = np.array([f[3] for f in self.fkeys], float)
        self.frf = np.array([self.rf_names.index(f[4]) if f[4] else -1 for f in self.fkeys])
        self.nrf = len(self.rf_names)

    # θ = [18 скоростей, sig, ip, tp, ut, β, log rf × nrf]
    def unpack(self, th):
        v = th[:18]; sig, ip, tp, ut, beta = th[18:23]; lrf = th[23:23 + self.nrf]
        return v, sig, ip, tp, ut, beta, lrf

    def seconds(self, th, idx=None):
        v, sig, ip, tp, ut, beta, lrf = self.unpack(th)
        sp = v[self.fc] * np.where(self.flink > 0, 0.5, 1.0)
        if self.nrf:
            sp = sp * np.where(self.frf >= 0, np.exp(lrf[np.maximum(self.frf, 0)]), 1.0)
        sp = np.minimum(sp, self.fcap)
        M = self.M if idx is None else self.M[idx]
        X = self.X if idx is None else self.X[idx]
        return M @ (3.6 / sp) + X[:, 0] + sig * X[:, 1] + ip * X[:, 2] + tp * X[:, 3] + ut * X[:, 4]

    def predict(self, th, idx=None):
        return self.seconds(th, idx) + self.unpack(th)[5]

    def bucket_w(self, idx):
        km = self.km[idx]
        w = np.zeros(len(idx))
        for lo, hi in BUCKETS:
            m = (km >= lo) & (km < hi)
            if m.sum():
                w[m] = 1.0 / m.sum()
        return w * len(idx) / len(BUCKETS)

    def fit(self, keys, lam=0.01, lam_rf=1.0, th0=None, fix=None, loss="soft_l1", f_scale=0.15):
        idx = np.array([self.row[k] for k in keys])
        t = self.t[idx]
        w = np.sqrt(self.bucket_w(idx))
        lo = [BOUNDS[c][0] for c in CLASSES for _ in ZONES] + [self.sig - 1e-3, 0, 0, 0, -120] + [-0.7] * self.nrf
        hi = [BOUNDS[c][1] for c in CLASSES for _ in ZONES] + [self.sig + 1e-3, 30, 60, 200, 300] + [0.7] * self.nrf
        if th0 is None:
            th0 = np.array([np.mean(BOUNDS[c]) for c in CLASSES for _ in ZONES] + [self.sig, 5, 15, 40, 20] + [0] * self.nrf, float)
        th0 = np.clip(th0, np.array(lo) + 1e-6, np.array(hi) - 1e-6)
        n = len(idx)

        def res(th):
            r = (self.predict(th, idx) - t) / t * w
            # регуляризация: скорость зоны тянется к средней по классу (в log), поправки магистралей — к 1
            v = th[:18].reshape(6, 3)
            lv = np.log(v)
            reg = (lv - lv.mean(axis=1, keepdims=True)).ravel() * np.sqrt(lam * n)
            reg2 = th[23:] * np.sqrt(lam_rf * n / 100) if self.nrf else np.zeros(0)
            return np.concatenate([r, reg, reg2])

        Mi, Xi = self.M[idx], self.X[idx]
        OH = np.zeros((len(self.fkeys), 18)); OH[np.arange(len(self.fkeys)), self.fc] = 1
        OR = np.zeros((len(self.fkeys), max(self.nrf, 1)))
        if self.nrf:
            ok = self.frf >= 0
            OR[np.where(ok)[0], self.frf[ok]] = 1
        sc = (w / t)[:, None]

        def jac(th):
            v, sig, ip, tp, ut, beta, lrf = self.unpack(th)
            sp0 = v[self.fc] * np.where(self.flink > 0, 0.5, 1.0)
            if self.nrf:
                sp0 = sp0 * np.where(self.frf >= 0, np.exp(lrf[np.maximum(self.frf, 0)]), 1.0)
            unc = sp0 < self.fcap
            g = np.where(unc, 3.6 / np.minimum(sp0, self.fcap), 0.0)
            A = Mi * g[None, :]
            J = np.zeros((len(idx) + 18 + self.nrf, len(th)))
            J[:len(idx), :18] = -(A @ OH) / v[None, :] * sc
            J[:len(idx), 18:22] = Xi[:, 1:5] * sc
            J[:len(idx), 22] = sc[:, 0]
            if self.nrf:
                J[:len(idx), 23:] = -(A @ OR) * sc
            for c in range(6):
                for a in range(3):
                    for b in range(3):
                        J[len(idx) + c * 3 + a, c * 3 + b] = ((a == b) - 1 / 3) / v[c * 3 + b] * np.sqrt(lam * n)
            if self.nrf:
                J[len(idx) + 18:, 23:] = np.eye(self.nrf) * np.sqrt(lam_rf * n / 100)
            return J

        sol = least_squares(res, th0, jac=jac, bounds=(lo, hi), loss=loss, f_scale=f_scale, x_scale="jac", max_nfev=3000)
        return sol.x

    def score(self, th, keys, f=1.0, beta=None):
        idx = np.array([self.row[k] for k in keys])
        b = self.unpack(th)[5] if beta is None else beta
        p = f * self.seconds(th, idx) + b
        e = np.abs(p - self.t[idx]) / self.t[idx]
        km = self.km[idx]
        bal = np.mean([e[(km >= lo) & (km < hi)].mean() for lo, hi in BUCKETS if ((km >= lo) & (km < hi)).any()])
        return float(bal), float(e.mean()), float(np.median(e))

    def to_params(self, th, base):
        v, sig, ip, tp, ut, beta, lrf = self.unpack(th)
        p = json.loads(json.dumps(base))
        p["zone_speeds"] = {c: {z: float(v[i * 3 + j]) for j, z in enumerate(ZONES)} for i, c in enumerate(CLASSES)}
        p["signal_penalty"], p["intersection_penalty"], p["turn_penalty"], p["u_turn_penalty"] = map(float, (sig, ip, tp, ut))
        p["road_factors"] = {n: float(np.exp(x)) for n, x in zip(self.rf_names, lrf)}
        p["beta"] = float(beta)
        return p


def point_folds(nf=5, seed=7):
    """Группы точек обучения → пары: обучение без точек группы, проверка — пары с точкой группы (как val)."""
    import random
    tr_pts = sorted(p for p, s in SPLIT["point"].items() if s == "train")
    random.Random(seed).shuffle(tr_pts)
    groups = [set(tr_pts[i::nf]) for i in range(nf)]
    train = [k for k in DAY if pair_part(k, SPLIT) == "train"]
    out = []
    for g in groups:
        te = [k for k in train if k[0] in g or k[1] in g]
        tr = [k for k in train if k[0] not in g and k[1] not in g]
        out.append((tr, te))
    return out, train
