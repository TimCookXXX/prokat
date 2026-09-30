"""Формула приложения поверх графа B (подход F): подбор только на train, CV по группам точек
(5 фолдов по точкам и по районам — как в D), сравнение с «как есть» (sec + β).

cd data/calibration
python ../../scripts/osrm/calibration/approaches/F-final/fit_f.py <table.json> <вариант> <out_dir>
вариант: raw (sec + β, β подбирается на train), A (формула D целиком), L (только длины: c, ls, lk, ld, изломы)
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "..", "D-app")
sys.path.insert(0, D)
from dmodel import load, rel_score  # noqa
import final as DF  # noqa  (features/fit/add_xy — формула D)
import exp2  # noqa  (фолды по точкам и районам)

GUARD_LO, GUARD_HI = 0.6, 1.3


def fit_beta(rs):
    """β для minutes = (sec + β)/60: минимум сбалансированной |ошибки| на сетке."""
    y = np.array([r["gs"] for r in rs], float); g = np.array([r["gm"] for r in rs]) / 1000
    s = np.array([r["sec"] for r in rs], float)
    best = min(np.arange(-30, 150, 0.5), key=lambda b: rel_score(s + b, y, g)["bal"])
    return float(best)


def fit(rs, variant):
    if variant == "raw":
        return {"beta": fit_beta(rs)}
    feat_variant = "A" if variant == "A" else "L"
    th, names = DF.fit(rs, feat_variant)
    return {"th": th, "names": names, "beta": fit_beta(rs), "fv": feat_variant}


def predict_s(m, rs, variant):
    sec = np.array([r["sec"] for r in rs], float)
    base = sec + m["beta"]
    if variant == "raw":
        return base
    z = DF.matrix(rs, m["fv"])[0] @ m["th"]
    return np.clip(np.exp(z), GUARD_LO * base, GUARD_HI * base)


def main():
    table, variant, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    rows, split = load(table)
    DF.add_xy(rows)
    ok = [r for r in rows if r["gs"] is not None and r["gm"] >= 300]
    tr = [r for r in ok if r["part"] == "train"]
    res = {"variant": variant, "table": table}
    for fk in ("pt", "cl"):
        f = exp2.FOLDS[fk]; P, Y, G = [], [], []
        for i in range(5):
            a = [r for r in tr if f(r["key"][0]) != i and f(r["key"][1]) != i]
            b = [r for r in tr if f(r["key"][0]) == i or f(r["key"][1]) == i]
            m = fit(a, variant)
            P.append(predict_s(m, b, variant)); Y += [r["gs"] for r in b]; G += [r["gm"] / 1000 for r in b]
        s = rel_score(np.concatenate(P), np.array(Y, float), np.array(G))
        res[f"cv_{fk}"] = s
        print(f"{variant} {os.path.basename(table)} CV {fk}:", " ".join(f"{k}:{v*100:.1f}" for k, v in s.items()), flush=True)
    m = fit(tr, variant)
    res["beta"] = m["beta"]
    if "th" in m:
        res["coef"] = dict(zip(m["names"], map(float, m["th"])))
    pred = {"|".join(r["key"]): [r["km"], float(predict_s(m, [r], variant)[0]) / 60] for r in rows}
    json.dump(pred, open(os.path.join(out, "pred.json"), "w"), ensure_ascii=False)
    json.dump(res, open(os.path.join(out, "fit.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
