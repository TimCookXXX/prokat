import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exp2 import *

LD = [math.log(k) for k in (0.5, 1, 2, 4, 8, 15)]


def design3(rs, spec):
    cols, names = [], []
    def add(n, v): names.append(n); cols.append(np.asarray(v, float))
    km = np.array([r["km"] for r in rs]); sec = np.array([r["sec"] for r in rs]); d = np.array([r["d"] for r in rs])
    add("c", np.ones(len(rs)))
    add("ls", np.log(sec + float(os.environ.get("B0", 23))))
    lk = np.log(np.maximum(km, 0.1)); ld = np.log(np.maximum(d, 0.1))
    add("lk", lk); add("ld", ld)
    for k, h in zip(LD, hinge(ld, LD)): add(f"ld>{math.exp(k):.1f}", h)
    if "lkh" in spec:
        for k, h in zip(LD, hinge(lk, LD)): add(f"lk>{math.exp(k):.1f}", h)
    if "floor" in spec:
        add("lsfloor", np.log(np.maximum(sec, 60)))  # короткий OSRM-путь → пол
    ra = np.array([r["ra"] for r in rs]); rb = np.array([r["rb"] for r in rs])
    if "zone" in spec:
        add("core", (ra <= 3).astype(float) + (rb <= 3)); add("outer", (ra > 8).astype(float) + (rb > 8))
    if "zonel" in spec:
        sh = np.clip((np.log(8) - ld) / np.log(8), 0, 2)
        add("core*sh", ((ra <= 3).astype(float) + (rb <= 3)) * sh); add("outer*sh", ((ra > 8).astype(float) + (rb > 8)) * sh)
    if "rr" in spec:  # плавно: расстояние концов от центра
        for k in (2, 4, 6, 9, 12):
            add(f"r>{k}", np.maximum(0, ra - k) + np.maximum(0, rb - k))
    if "snap" in spec:
        add("snap", (np.minimum([r["snap_a"] for r in rs], 300) + np.minimum([r["snap_b"] for r in rs], 300)) / 100)
    if "rmin" in spec:
        rm = np.array([r["rmin"] for r in rs]); add("rmin<3", rm < 3)
    if "cross" in spec: add("cross", [r["cross"] for r in rs])
    if "okr" in spec:
        for o in OKRUGS[1:] + [None]:
            add(f"okr:{o}", [(r["okr_a"] == o) + (r["okr_b"] == o) for r in rs])
    if "same" in spec: add("same_okrug", [r["same_okrug"] for r in rs])
    return np.column_stack(cols), names


def fit3(rs, spec, lam, eps=0.02):
    X, names = design3(rs, spec)
    y = np.array([r["gs"] for r in rs], float); g = np.array([r["gm"] for r in rs]) / 1000
    p0 = np.zeros(X.shape[1]); p0[1] = 1.0; mask = np.ones(len(p0)); mask[0] = 0
    return fit_log(X, y, bucket_w(g), lam, prior=p0, pen_mask=mask, eps=eps, theta0=p0), names


def cv3(spec, lam, fk):
    return cv(None, 0, fk, fitter=lambda a: fit3(a, spec, lam)[0], predictor=lambda th, b: np.exp(design3(b, spec)[0] @ th))


if __name__ == "__main__":
    for spec in [(), ("lkh",), ("floor",), ("zone",), ("zonel",), ("rr",), ("zone", "zonel"), ("zone", "snap"), ("zone", "rr", "snap"),
                 ("zone", "zonel", "snap", "rmin", "cross"), ("zone", "zonel", "snap", "rmin", "cross", "okr", "same"),
                 ("lkh", "zone", "zonel", "snap", "rmin", "cross")]:
        for lam in (0.001, 0.01):
            a = cv3(spec, lam, "pt"); b = cv3(spec, lam, "cl")
            print(f"{'+'.join(spec) or '-':42s} {lam:<6} pt " + " ".join(f"{v*100:.1f}" for v in a.values()) + " | cl " + " ".join(f"{v*100:.1f}" for v in b.values()), flush=True)
