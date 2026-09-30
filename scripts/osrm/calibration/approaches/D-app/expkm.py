import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exp7 import *

LDK = [math.log(k) for k in (0.5, 1, 2, 4, 8)]


def dkm(rs, spec):
    km = np.array([r["km"] for r in rs]); d = np.array([r["d"] for r in rs])
    lk = np.log(np.maximum(km, 0.05)); ld = np.log(np.maximum(d, 0.05))
    cols = [np.ones(len(rs)), lk]
    if "ld" in spec:
        cols += [ld] + hinge(ld, LDK)
    if "det" in spec:
        cols += [np.clip(lk - ld, -1, 1.5)]
    if "rr" in spec:
        ra = np.array([r["ra"] for r in rs]); rb = np.array([r["rb"] for r in rs])
        cols += [np.maximum(0, ra - k) + np.maximum(0, rb - k) for k in (2, 6, 12)]
    if "snap" in spec:
        cols += [(np.minimum([r["snap_a"] for r in rs], 300) + np.minimum([r["snap_b"] for r in rs], 300)) / 100]
    return np.column_stack(cols)


def fitkm(rs, spec, lam=0.003):
    X = dkm(rs, spec); y = np.array([r["gm"] for r in rs]) / 1000.0
    w = np.ones(len(rs)) / len(rs)
    p0 = np.zeros(X.shape[1]); p0[1] = 1; mask = np.ones(len(p0)); mask[0] = 0
    return fit_log(X, y, w, lam, prior=p0, pen_mask=mask, eps=0.005, theta0=p0)


def cvkm(spec, fk):
    f = FOLDS[fk]; e = []
    for i in range(5):
        a = [r for r in tr if f(r["key"][0]) != i and f(r["key"][1]) != i]
        b = [r for r in tr if f(r["key"][0]) == i or f(r["key"][1]) == i]
        th = fitkm(a, spec) if spec is not None else None
        p = np.exp(dkm(b, spec or ()) @ th) if spec is not None else np.array([r["km"] for r in b])
        e.append(np.abs(p / (np.array([r["gm"] for r in b]) / 1000) - 1))
    e = np.concatenate(e)
    return np.median(e), e.mean(), np.percentile(e, 90)


if __name__ == "__main__":
    for spec in [None, (), ("det",), ("ld",), ("ld", "det"), ("ld", "det", "rr"), ("ld", "det", "snap")]:
        print(spec, " ".join(f"{v*100:.2f}" for v in cvkm(spec, "pt")), "|", " ".join(f"{v*100:.2f}" for v in cvkm(spec, "cl")))
