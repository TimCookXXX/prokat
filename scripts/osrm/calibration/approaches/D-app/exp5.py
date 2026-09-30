import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exp3 import *
from gbm import fit_gbm, gbm_pred

GF = {
    "core": ["lk", "ld", "ldet", "lpace", "rlo", "rhi", "rmin", "snlo", "snhi"],
    "okr": ["nz", "nt", "nk", "np", "nn", "cross", "same"],
    "xy": ["xa", "ya", "xb", "yb"],
}


def gfeat(rs, groups):
    km = np.array([r["km"] for r in rs]); sec = np.array([r["sec"] for r in rs]); d = np.array([r["d"] for r in rs])
    ra = np.array([r["ra"] for r in rs]); rb = np.array([r["rb"] for r in rs])
    sa = np.minimum([r["snap_a"] for r in rs], 300); sb = np.minimum([r["snap_b"] for r in rs], 300)
    F = {"lk": np.log(np.maximum(km, 0.1)), "ld": np.log(np.maximum(d, 0.1)), "ldet": np.log(np.clip(km / np.maximum(d, 0.1), 0.2, 5)),
         "lpace": np.log((sec + 23) / np.maximum(km, 0.1)), "rlo": np.minimum(ra, rb), "rhi": np.maximum(ra, rb),
         "rmin": np.array([r["rmin"] for r in rs]), "snlo": np.minimum(sa, sb), "snhi": np.maximum(sa, sb)}
    for c, o in zip("ztkpn", OKRUGS + [None]):
        F["n" + c] = np.array([(r["okr_a"] == o) + (r["okr_b"] == o) for r in rs], float)
    F["cross"] = np.array([r["cross"] for r in rs], float); F["same"] = np.array([r["same_okrug"] for r in rs], float)
    names = [n for g in groups for n in GF[g]]
    return np.column_stack([F[n] for n in names]), names


def mk(spec, lam, groups, **kw):
    def fitter(a):
        th, _ = fit3(a, spec, lam)
        X, _ = gfeat(a, groups)
        f0 = design3(a, spec)[0] @ th
        ly = np.log([r["gs"] for r in a]); w = bucket_w(np.array([r["gm"] for r in a]) / 1000)
        return th, fit_gbm(X, f0, ly, w, **kw)
    def predictor(m, b):
        th, trees = m
        return np.exp(design3(b, spec)[0] @ th + gbm_pred(trees, gfeat(b, groups)[0]))
    return fitter, predictor


if __name__ == "__main__":
    for spec, groups, kw in [
        ((), ("core",), dict(n_trees=100, depth=2)),
        ((), ("core",), dict(n_trees=200, depth=2)),
        ((), ("core",), dict(n_trees=100, depth=3)),
        ((), ("core", "okr"), dict(n_trees=100, depth=2)),
        (("zone", "rr", "snap"), ("core",), dict(n_trees=100, depth=2)),
        (("zone", "rr", "snap"), ("core", "okr"), dict(n_trees=100, depth=2)),

    ]:
        fi, pr = mk(spec, 0.01, groups, **kw)
        a = cv(None, 0, "pt", fitter=fi, predictor=pr); b = cv(None, 0, "cl", fitter=fi, predictor=pr)
        print(f"{'+'.join(spec) or '-'} {groups} {kw} pt " + " ".join(f"{v*100:.1f}" for v in a.values()) + " | cl " + " ".join(f"{v*100:.1f}" for v in b.values()), flush=True)
