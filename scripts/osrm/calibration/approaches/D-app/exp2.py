"""Сравнение семейств формул: CV по точкам (как fit3.py) и строже — по районам (кластерам точек)."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dmodel import *
import warnings; warnings.filterwarnings("ignore")

rows, split = load(os.environ.get("TABLE", "approaches/D-app/table_base.json"))
pts = {p["id"]: p for p in json.load(open("points.json"))}
micro = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../../../data/calibration/approaches/D-app/micro.json")))
R = [r for r in rows if r["gs"] is not None and r["gm"] >= 300]
tr = [r for r in R if r["part"] == "train"]
LK = [math.log(k) for k in (1, 2, 3, 5, 8, 15, 25)]


def cluster(pid):
    s = pid.split(":")
    if s[0] in ("h", "m"):
        return s[1]
    p = pts[pid]
    best = min(micro, key=lambda m: (m["lat"] - p["lat"]) ** 2 + ((m["lon"] - p["lon"]) * 0.707) ** 2)
    dkm = math.hypot((best["lat"] - p["lat"]) * 111.2, (best["lon"] - p["lon"]) * 78.6)
    return best["name"] if dkm < 2.5 else pid


def folds_point():
    g = point_folds(split)
    return lambda pid: g[pid]


def folds_cluster(seed=11):
    cl = sorted({cluster(p) for p, v in split["point"].items() if v == "train"})
    rnd = np.random.RandomState(seed); perm = rnd.permutation(len(cl))
    m = {cl[i]: int(j % 5) for j, i in enumerate(perm)}
    return lambda pid: m[cluster(pid)]


FOLDS = {"pt": folds_point(), "cl": folds_cluster()}


def design(rs, spec):
    cols, names = [], []
    def add(n, v): names.append(n); cols.append(np.asarray(v, float))
    km = np.array([r["km"] for r in rs]); sec = np.array([r["sec"] for r in rs])
    add("c", np.ones(len(rs)))
    add("ls", np.log(sec + 23))
    lk = np.log(np.maximum(km, 0.2))
    if "lk" in spec:
        for k, h in zip(LK, hinge(lk, LK)): add(f"lk>{math.exp(k):.0f}", h)
    if "det" in spec: add("ldet", np.log(np.clip([r["detour"] for r in rs], 1, 4)))
    if "snap" in spec:
        add("snap", (np.minimum([r["snap_a"] for r in rs], 300) + np.minimum([r["snap_b"] for r in rs], 300)) / 100)
    if "zone" in spec:
        ra = np.array([r["ra"] for r in rs]); rb = np.array([r["rb"] for r in rs])
        add("core", (ra <= 3).astype(float) + (rb <= 3)); add("outer", (ra > 8).astype(float) + (rb > 8))
    if "zonel" in spec:  # то же, но с долей: чем короче поездка, тем сильнее вклад зоны концов
        ra = np.array([r["ra"] for r in rs]); rb = np.array([r["rb"] for r in rs])
        sh = np.clip((np.log(8) - lk) / np.log(8), 0, 1.5)
        add("core*sh", ((ra <= 3).astype(float) + (rb <= 3)) * sh); add("outer*sh", ((ra > 8).astype(float) + (rb > 8)) * sh)
    if "rmin" in spec:
        rm = np.array([r["rmin"] for r in rs]); add("rmin<3", rm < 3); add("rmin<1.5", rm < 1.5)
    if "cross" in spec: add("cross", [r["cross"] for r in rs])
    if "okr" in spec:
        for o in OKRUGS[1:] + [None]:
            add(f"okr:{o}", [(r["okr_a"] == o) + (r["okr_b"] == o) for r in rs])
    if "okrab" in spec:
        for e in "ab":
            for o in OKRUGS[1:] + [None]:
                add(f"{e}:{o}", [r["okr_" + e] == o for r in rs])
    if "same" in spec: add("same_okrug", [r["same_okrug"] for r in rs])
    return np.column_stack(cols), names


def arr(rs, spec):
    X, n = design(rs, spec)
    return X, np.array([r["gs"] for r in rs], float), np.array([r["gm"] for r in rs]) / 1000, n


def fit_rows(rs, spec, lam, eps=0.02):
    X, y, g, names = arr(rs, spec)
    p0 = np.zeros(X.shape[1]); p0[1] = 1.0; mask = np.ones(len(p0)); mask[0] = 0
    return fit_log(X, y, bucket_w(g), lam, prior=p0, pen_mask=mask, eps=eps, theta0=p0), names


def cv(spec, lam, fk="pt", fitter=None, predictor=None):
    f = FOLDS[fk]
    preds, ys, gms = [], [], []
    for i in range(5):
        a = [r for r in tr if f(r["key"][0]) != i and f(r["key"][1]) != i]
        b = [r for r in tr if f(r["key"][0]) == i or f(r["key"][1]) == i]
        if fitter:
            m = fitter(a); p = predictor(m, b)
        else:
            th, _ = fit_rows(a, spec, lam); p = np.exp(arr(b, spec)[0] @ th)
        preds.append(p); ys.append([r["gs"] for r in b]); gms.append([r["gm"] / 1000 for r in b])
    return rel_score(np.concatenate(preds), np.concatenate(ys).astype(float), np.concatenate(gms))


def show(tag, s):
    print(f"{tag:55s}", " ".join(f"{k}:{v*100:.1f}" for k, v in s.items()), flush=True)


if __name__ == "__main__":
    base = dict(fitter=lambda a: None, predictor=lambda m, b: np.array([r["sec"] + 23 for r in b]))
    show("base pt", cv(None, 0, "pt", **base)); show("base cl", cv(None, 0, "cl", **base))
    specs = [("lk",), ("lk", "det"), ("lk", "det", "zone"), ("lk", "det", "zonel"), ("lk", "det", "zone", "zonel"),
             ("lk", "det", "zone", "okr"), ("lk", "det", "zone", "okrab"), ("lk", "det", "zone", "okr", "snap"),
             ("lk", "det", "zone", "okr", "snap", "rmin", "cross", "same"),
             ("lk", "det", "zone", "zonel", "okr", "snap", "rmin", "cross", "same")]
    for spec in specs:
        for fk in ("pt", "cl"):
            show(f"{'+'.join(spec)} {fk}", cv(spec, 0.003, fk))
