import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dmodel import *

rows, split = load("approaches/D-app/table_base.json")
grp = point_folds(split)
R = [r for r in rows if r["gs"] is not None and r["gm"] >= 300]
tr = [r for r in R if r["part"] == "train"]
LK = [math.log(k) for k in (1, 2, 3, 5, 8, 15, 25)]


def design(rs, spec):
    cols, names = [], []
    def add(n, v): names.append(n); cols.append(np.asarray(v, float))
    km = np.array([r["km"] for r in rs]); sec = np.array([r["sec"] for r in rs])
    add("c", np.ones(len(rs)))
    add("ls", np.log(sec + 23))
    if "lk" in spec:
        lk = np.log(np.maximum(km, 0.2))
        for k, h in zip(LK, hinge(lk, LK)): add(f"lk>{math.exp(k):.0f}", h)
    if "lkm" in spec: add("lkm", np.log(np.maximum(km, 0.2)))
    if "det" in spec: add("ldet", np.log(np.clip([r["detour"] for r in rs], 1, 4)))
    if "snap" in spec:
        add("snap_a", np.minimum([r["snap_a"] for r in rs], 300) / 100)
        add("snap_b", np.minimum([r["snap_b"] for r in rs], 300) / 100)
    if "zone" in spec:
        for e in "ab":
            rr = np.array([r["r" + e] for r in rs])
            add(f"core_{e}", rr <= 3); add(f"outer_{e}", rr > 8)
    if "rmin" in spec:
        rm = np.array([r["rmin"] for r in rs]); add("rmin<3", rm < 3); add("rmin<1.5", rm < 1.5)
    if "cross" in spec: add("cross", [r["cross"] for r in rs])
    if "okr" in spec:
        for e in "ab":
            for o in OKRUGS[1:] + [None]:
                add(f"{e}:{o}", [r["okr_" + e] == o for r in rs])
    if "same" in spec: add("same_okrug", [r["same_okrug"] for r in rs])
    return np.column_stack(cols), names


def run(spec, lam, eps=0.02, verbose=False):
    def arr(rs):
        X, n = design(rs, spec)
        return X, np.array([r["gs"] for r in rs], float), np.array([r["gm"] for r in rs]) / 1000, n
    prior = None
    preds, ys, gms = [], [], []
    for i in range(5):
        a = [r for r in tr if grp[r["key"][0]] != i and grp[r["key"][1]] != i]
        b = [r for r in tr if grp[r["key"][0]] == i or grp[r["key"][1]] == i]
        Xa, ya, ga, names = arr(a); Xb, yb, gb, _ = arr(b)
        p0 = np.zeros(Xa.shape[1]); p0[1] = 1.0
        mask = np.ones(len(p0)); mask[0] = 0
        th = fit_log(Xa, ya, bucket_w(ga), lam, prior=p0, pen_mask=mask, eps=eps, theta0=p0)
        preds.append(np.exp(Xb @ th)); ys.append(yb); gms.append(gb)
    cv = rel_score(np.concatenate(preds), np.concatenate(ys), np.concatenate(gms))
    X, y, g, names = arr(tr)
    p0 = np.zeros(X.shape[1]); p0[1] = 1.0; mask = np.ones(len(p0)); mask[0] = 0
    th = fit_log(X, y, bucket_w(g), lam, prior=p0, pen_mask=mask, eps=eps, theta0=p0)
    return cv, th, names


if __name__ == "__main__":
    # базовая линия: f·sec+23
    y = np.array([r["gs"] for r in tr]); g = np.array([r["gm"] for r in tr]) / 1000
    print("base train", {k: round(v, 4) for k, v in rel_score(np.array([r["sec"] + 23 for r in tr]), y, g).items()})
    for spec in [(), ("lk",), ("lk", "det"), ("lk", "snap"), ("lk", "zone"), ("lk", "rmin"), ("lk", "cross"), ("lk", "okr"), ("lk", "same"),
                 ("lk", "det", "snap", "zone", "rmin", "cross", "okr", "same")]:
        for lam in (0.0001, 0.001, 0.01):
            cv, th, names = run(spec, lam)
            print(spec, lam, " ".join(f"{k}:{v*100:.1f}" for k, v in cv.items()))
