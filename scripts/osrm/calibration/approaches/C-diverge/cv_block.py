"""Перекрёстная проверка блокировок по группам точек обучения: кандидаты — из пар без точек группы,
эффект — на парах с точкой группы (как новые адреса). python cv_block.py <c0> <spread0> [mode]"""
import sys, os, pickle, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ev, cfg
from way_ridge import candidates
from fit_time import point_folds, DAY

c0, s0 = float(sys.argv[1]), int(sys.argv[2])
mode = sys.argv[3] if len(sys.argv) > 3 else "block"   # block: вне графа; slow: вес ×0.5
MINOR = {"residential", "unclassified", "service", "living_street", "track"}
R0 = pickle.load(open("approaches/C-diverge/routes_r1.pkl", "rb"))
ways = ev.edge_index()["ways"]
folds, train = point_folds()


def pick(R, keys):
    out = []
    for w, co, n, spread, my in candidates(R, keys):
        if co >= c0 and spread >= s0:
            out.append(w)
    return out


def ly(R, keys):
    return np.array([abs(np.log(DAY[k]["m"] / R[k]["m"])) for k in keys])


tot0, tot1, allk = [], [], []
for i, (tr, te) in enumerate(folds):
    ws = pick(R0, tr)
    p = cfg.r1()
    minor = [w for w in ws if ways[w][0].get("highway") in MINOR]
    major = [w for w in ws if w not in minor]
    if mode == "block":
        p["block_ways"] = minor
        p["slow_ways"] = {w: 0.6 for w in major}
    else:
        p["slow_ways"] = {w: 0.5 for w in ws}
    ev.build(p, f"cv{i}")
    R1 = ev.routes(pairs=te, nodes=False)
    a, b = ly(R0, te), ly(R1, te)
    print(f"fold {i}: кандидатов {len(ws)} (дворовых {len(minor)}), пар {len(te)}: |log| {a.mean():.4f} → {b.mean():.4f}", flush=True)
    tot0 += list(a); tot1 += list(b)
print(f"ИТОГ c0={c0} s0={s0} {mode}: |log| {np.mean(tot0):.4f} → {np.mean(tot1):.4f}  (разница {np.mean(tot1)-np.mean(tot0):+.4f})")
