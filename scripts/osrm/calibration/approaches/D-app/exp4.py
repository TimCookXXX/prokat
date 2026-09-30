"""Смешанная формула: минуты·60 = sec·exp(Xm·θm) + Xa·θa (добавка концов в секундах)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exp2 import *
from scipy.optimize import minimize

LD = [math.log(k) for k in (0.5, 1, 2, 4, 8, 15)]
RK = (2, 4, 6, 9, 12)


def mats(rs, spec):
    km = np.array([r["km"] for r in rs]); sec = np.array([r["sec"] for r in rs]); d = np.array([r["d"] for r in rs])
    lk = np.log(np.maximum(km, 0.1)); ld = np.log(np.maximum(d, 0.1))
    ra = np.array([r["ra"] for r in rs]); rb = np.array([r["rb"] for r in rs])
    M, mn = [np.ones(len(rs))], ["c"]
    def am(n, v): M.append(np.asarray(v, float)); mn.append(n)
    am("ldet", np.clip(lk - ld, 0, 1.5))
    for k, h in zip(LD, hinge(ld, LD)): am(f"ld>{math.exp(k):.1f}", h)
    if "mrr" in spec:
        for k in RK: am(f"m:r>{k}", np.maximum(0, ra - k) + np.maximum(0, rb - k))
    if "mzone" in spec:
        am("m:core", (ra <= 3).astype(float) + (rb <= 3)); am("m:outer", (ra > 8).astype(float) + (rb > 8))
    if "mrmin" in spec:
        am("m:rmin<3", np.array([r["rmin"] for r in rs]) < 3)
    if "mcross" in spec: am("m:cross", [r["cross"] for r in rs])
    if "mokr" in spec:
        for o in OKRUGS[1:] + [None]:
            am(f"m:okr:{o}", [(r["okr_a"] == o) + (r["okr_b"] == o) for r in rs])
    A, an = [np.ones(len(rs))], ["a:c"]
    def aa(n, v): A.append(np.asarray(v, float)); an.append(n)
    if "arr" in spec:
        for k in RK: aa(f"a:r>{k}", np.maximum(0, ra - k) + np.maximum(0, rb - k))
    if "azone" in spec:
        aa("a:core", (ra <= 3).astype(float) + (rb <= 3)); aa("a:outer", (ra > 8).astype(float) + (rb > 8))
    if "asnap" in spec:
        aa("a:snap", (np.minimum([r["snap_a"] for r in rs], 300) + np.minimum([r["snap_b"] for r in rs], 300)) / 100)
    if "aokr" in spec:
        for o in OKRUGS[1:] + [None]:
            aa(f"a:okr:{o}", [(r["okr_a"] == o) + (r["okr_b"] == o) for r in rs])
    return sec, np.column_stack(M), mn, np.column_stack(A), an


def fit_mixed(rs, spec, lam_m, lam_a, eps=0.02):
    sec, M, mn, A, an = mats(rs, spec)
    y = np.array([r["gs"] for r in rs], float); w = bucket_w(np.array([r["gm"] for r in rs]) / 1000)
    pm, pa = M.shape[1], A.shape[1]
    mm = np.ones(pm); mm[0] = 0
    ma = np.ones(pa); ma[0] = 0

    def fg(th):
        tm, ta = th[:pm], th[pm:]
        em = sec * np.exp(M @ tm)
        p = em + A @ ta
        r = p / y - 1
        s = np.sqrt(r * r + eps * eps)
        gr = w * r / s / y
        L = (w * s).sum() + lam_m * (mm * tm ** 2).sum() + lam_a * (ma * (ta / 60) ** 2).sum()
        g = np.concatenate([M.T @ (gr * em) + 2 * lam_m * mm * tm, A.T @ gr + 2 * lam_a * ma * ta / 3600])
        return L, g
    th0 = np.zeros(pm + pa); th0[pm] = 23
    res = minimize(fg, th0, jac=True, method="L-BFGS-B", options={"maxiter": 5000})
    return res.x, mn + an


def pred_mixed(th, rs, spec):
    sec, M, mn, A, an = mats(rs, spec)
    return sec * np.exp(M @ th[:M.shape[1]]) + A @ th[M.shape[1]:]


def cv4(spec, lm, la, fk):
    return cv(None, 0, fk, fitter=lambda a: fit_mixed(a, spec, lm, la)[0], predictor=lambda th, b: pred_mixed(th, b, spec))


if __name__ == "__main__":
    for spec in [(), ("mrr",), ("arr",), ("mrr", "arr"), ("mzone", "azone"), ("mrr", "arr", "asnap"), ("mrr", "arr", "asnap", "mrmin", "mcross"),
                 ("mrr", "arr", "asnap", "mokr"), ("mrr", "arr", "asnap", "aokr")]:
        for lm, la in ((0.003, 0.001), (0.01, 0.01)):
            a = cv4(spec, lm, la, "pt"); b = cv4(spec, lm, la, "cl")
            print(f"{'+'.join(spec) or '-':40s} {lm},{la} pt " + " ".join(f"{v*100:.1f}" for v in a.values()) + " | cl " + " ".join(f"{v*100:.1f}" for v in b.values()), flush=True)
