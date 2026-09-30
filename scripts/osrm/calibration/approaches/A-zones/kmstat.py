"""Совпадение километров маршрута OSRM с 2ГИС по диапазонам (train, day). python kmstat.py <версия>…"""
import sys
import numpy as np
from common import load, load_feat, BUCKETS
ref, split, parts = load()
for ver in sys.argv[1:]:
    F = load_feat(ver)
    ks = [k for k in ref if parts[k] == "train" and k in F]
    gm = np.array([ref[k]["m"] for k in ks]); om = np.array([F[k]["m"] for k in ks])
    e = np.abs(om - gm) / gm
    s = f"{ver:10s} км: медиана {np.median(e)*100:.1f}% средняя {e.mean()*100:.1f}% >25%: {np.mean(e>.25)*100:.1f}% |"
    for lo, hi in BUCKETS:
        m = (gm >= lo * 1000) & (gm < hi * 1000)
        s += f" {lo}-{hi if hi < 1e8 else ''}: мед {np.median(e[m])*100:.1f} ср {e[m].mean()*100:.1f} >25% {np.mean(e[m]>.25)*100:.0f}%"
    print(s)
