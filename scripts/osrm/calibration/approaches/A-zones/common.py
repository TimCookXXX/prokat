"""Общее для подхода A-zones: эталон, признаки, разбиение, метрики."""
import json, os, random, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "../.."))
from evalkit import load_work, pair_part, score, fmt, BUCKETS  # noqa

OUT = "approaches/A-zones"
CENTER = (45.0355, 38.9753)


def dist_center(lat, lon):
    dy = (lat - CENTER[0]) * 111.2
    dx = (lon - CENTER[1]) * 111.2 * 0.707
    return (dx * dx + dy * dy) ** 0.5


def load(label="day"):
    ref, split = load_work()
    ref = ref[label]
    parts = {k: pair_part(k, split) for k in ref}
    return ref, split, parts


def crow_m(a, b):
    dy = (a["lat"] - b["lat"]) * 111.2
    dx = (a["lon"] - b["lon"]) * 111.2 * np.cos(np.radians((a["lat"] + b["lat"]) / 2))
    return float(np.hypot(dx, dy) * 1000)


def nearest_micro(p, micros):
    """Микрорайон точки — ближайший центр микрорайона (как на сайте), дальше 3 км — нет."""
    m = min(micros, key=lambda q: crow_m(p, q))
    return m["id"][2:] if crow_m(p, m) <= 3000 else ""


def load_feat(ver):
    p = f"{OUT}/feat_{ver}.json"
    pts = {q["id"]: q for q in json.load(open("points.json"))}
    F = {tuple(k.split("|")): v for k, v in json.load(open(p)).items()}
    micros = [q for q in pts.values() if q["kind"] == "micro"]
    for k, v in F.items():
        v["crow"] = crow_m(pts[k[0]], pts[k[1]])
        v["ep_d"] = [dist_center(pts[q]["lat"], pts[q]["lon"]) for q in k]
        v["ep_mic"] = [nearest_micro(pts[q], micros) for q in k]
    return F


def point_groups(keys, n=5, seed=11):
    pts = sorted({p for k in keys for p in k})
    grp = {p: i % n for i, p in enumerate(random.Random(seed).sample(pts, len(pts)))}
    folds = []
    for i in range(n):
        te = [k for k in keys if grp[k[0]] == i or grp[k[1]] == i]
        tr = [k for k in keys if grp[k[0]] != i and grp[k[1]] != i]
        folds.append((tr, te))
    return folds


def balanced(pred_s, true_s, true_m):
    e = np.abs(pred_s - true_s) / true_s
    km = true_m / 1000
    out = []
    for lo, hi in BUCKETS:
        m = (km >= lo) & (km < hi)
        if m.sum():
            out.append(e[m].mean())
    return float(np.mean(out)), [float(x) for x in out]


def bucket_weights(true_m):
    """Веса пар так, чтобы каждый диапазон длины весил одинаково (как min_balanced)."""
    km = np.asarray(true_m) / 1000
    w = np.zeros(len(km))
    for lo, hi in BUCKETS:
        m = (km >= lo) & (km < hi)
        if m.sum():
            w[m] = 1.0 / m.sum()
    return w * len(km) / len(BUCKETS)
