"""Итоговая формула приложения (подход D): подбор на train, CV по точкам и по районам,
прогноз для всех пар эталона в формате predict_table, app_formula.json.

cd data/calibration
python ../../scripts/osrm/calibration/approaches/D-app/final.py <table.json> <вариант A|B|raw> <out_dir>
table.json — collect_variant.py с "&snapping=any" (то, что сайт получает от /table).
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dmodel import load, bucket_w, fit_log, rel_score  # noqa
from dfeat import CENTER, KX, KY  # noqa

B0 = 60.0             # секунды, добавка внутри логарифма времени OSRM
KNOTS = (0.5, 1, 2, 4, 8, 15)  # км — изломы по длине (прямая и OSRM)
RK = (2, 4, 6, 9, 12)          # км от центра — изломы «насколько далеко от центра концы»
LAM = 0.003


def features(r, variant):
    """r: km, sec (OSRM /table, snapping=any), d (км по прямой), ra, rb (км от центра),
    rmin (км от центра до отрезка a-b), cross (разные берега Кубани), xa, ya, xb, yb (км от центра)."""
    f = {"c": 1.0, "ls": math.log(r["sec"] + B0)}
    lk = math.log(max(r["km"], 0.1)); ld = math.log(max(r["d"], 0.1))
    f["lk"] = lk; f["ld"] = ld
    for k in KNOTS:
        f[f"ld>{k}"] = max(0.0, ld - math.log(k))
    for k in KNOTS:
        f[f"lk>{k}"] = max(0.0, lk - math.log(k))
    for k in RK:
        f[f"r>{k}"] = max(0.0, r["ra"] - k) + max(0.0, r["rb"] - k)
    f["rmin<3"] = 1.0 if r["rmin"] < 3 else 0.0
    f["cross"] = 1.0 if r["cross"] else 0.0
    if variant == "A":
        f["north"] = max(0.0, r["ya"]) + max(0.0, r["yb"])
        f["south"] = max(0.0, -r["ya"]) + max(0.0, -r["yb"])
        f["east"] = max(0.0, r["xa"]) + max(0.0, r["xb"])
        f["west"] = max(0.0, -r["xa"]) + max(0.0, -r["xb"])
    return f


def matrix(rs, variant):
    F = [features(r, variant) for r in rs]
    names = list(F[0])
    return np.array([[f[n] for n in names] for f in F]), names


def fit(rs, variant):
    X, names = matrix(rs, variant)
    y = np.array([r["gs"] for r in rs], float); g = np.array([r["gm"] for r in rs]) / 1000
    p0 = np.zeros(len(names)); p0[names.index("ls")] = 1.0
    mask = np.ones(len(names)); mask[names.index("c")] = 0
    return fit_log(X, y, bucket_w(g), LAM, prior=p0, pen_mask=mask, eps=0.02, theta0=p0), names


def predict_s(th, rs, variant):
    if variant == "raw":
        return np.array([r["sec"] + 23 for r in rs])
    return np.exp(matrix(rs, variant)[0] @ th)


def add_xy(rows):
    pts = {p["id"]: p for p in json.load(open("points.json"))}
    for r in rows:
        a, b = pts[r["key"][0]], pts[r["key"][1]]
        r["xa"], r["ya"] = (a["lon"] - CENTER[1]) * KX, (a["lat"] - CENTER[0]) * KY
        r["xb"], r["yb"] = (b["lon"] - CENTER[1]) * KX, (b["lat"] - CENTER[0]) * KY


def main():
    table, variant, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    rows, split = load(table)
    add_xy(rows)
    ok = [r for r in rows if r["gs"] is not None and r["gm"] >= 300]
    tr = [r for r in ok if r["part"] == "train"]
    import exp2
    res = {"variant": variant, "table": table}
    if variant != "raw":
        for fk in ("pt", "cl"):
            f = exp2.FOLDS[fk]; P, Y, G = [], [], []
            for i in range(5):
                a = [r for r in tr if f(r["key"][0]) != i and f(r["key"][1]) != i]
                b = [r for r in tr if f(r["key"][0]) == i or f(r["key"][1]) == i]
                th, _ = fit(a, variant)
                P.append(predict_s(th, b, variant)); Y += [r["gs"] for r in b]; G += [r["gm"] / 1000 for r in b]
            s = rel_score(np.concatenate(P), np.array(Y, float), np.array(G))
            res[f"cv_{fk}"] = s
            print(f"CV {fk}:", " ".join(f"{k}:{v*100:.1f}" for k, v in s.items()))
        th, names = fit(tr, variant)
    else:
        th, names = None, []
    pred = {}
    for r in rows:  # все пары эталона (все метки, прогноз — дневное время)
        pred["|".join(r["key"])] = [r["km"], float(predict_s(th, [r], variant)[0]) / 60]
    json.dump(pred, open(os.path.join(out, "pred.json"), "w"), ensure_ascii=False)
    s = rel_score(predict_s(th, tr, variant), np.array([r["gs"] for r in tr], float), np.array([r["gm"] for r in tr]) / 1000)
    res["train_fit"] = s
    print("train (in-sample):", " ".join(f"{k}:{v*100:.1f}" for k, v in s.items()))
    if th is not None:
        res["coef"] = dict(zip(names, map(float, th)))
        for n, t in zip(names, th):
            print(f"  {n:10s} {t:+.5f}")
    json.dump(res, open(os.path.join(out, "fit.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
