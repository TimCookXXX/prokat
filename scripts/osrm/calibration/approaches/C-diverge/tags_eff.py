"""Признаки участков (тип, покрытие, доступ, имя) → связь с расхождением км (train, day).
Разделяет подъезд (первые/последние 500 м) и середину маршрута."""
import json, pickle, sys, collections
import numpy as np
np.seterr(all="ignore")
sys.path.insert(0, "/Users/timur/Desktop/sravniprokat/scripts/osrm/calibration")
from evalkit import load_work, pair_part
routes = pickle.load(open(sys.argv[1], "rb"))
part = sys.argv[2] if len(sys.argv) > 2 else "train"
idx = pickle.load(open("approaches/C-diverge/osmindex.pkl", "rb"))
ways = idx["ways"]
ref, split = load_work(); day = ref["day"]
keys = [k for k in day if pair_part(k, split) == part]
UNP = {"gravel", "unpaved", "ground", "dirt", "compacted", "fine_gravel", "sand", "earth", "grass", "mud", "pebblestone"}
def feats(w):
    t = ways[w][0]; hw = t.get("highway", "")
    out = [f"hw={hw}"]
    s = t.get("surface")
    out.append("surf=unpaved" if s in UNP else "surf=paved" if s else "surf=none")
    if hw in ("residential", "unclassified", "service", "living_street", "track"):
        out.append(f"{hw}|{'unpaved' if s in UNP else 'paved' if s else 'nosurf'}|{'named' if t.get('name') else 'noname'}")
    a = t.get("access") or t.get("motor_vehicle") or t.get("motorcar")
    if a: out.append(f"access={a}")
    if t.get("service"): out.append(f"service={t['service']}")
    if hw == "track": out.append(f"tracktype={t.get('tracktype','none')}")
    return out
y = np.array([np.log(day[k]["m"] / routes[k]["m"]) for k in keys])
yt = np.array([np.log(day[k]["s"] / (routes[k]["s"] + 23)) for k in keys])
F = collections.defaultdict(lambda: np.zeros(len(keys)))
for i, k in enumerate(keys):
    ws = routes[k]["ways"]; tot = sum(m for _, m, _ in ws)
    acc = 0
    for w, m, s in ws:
        pos = "end" if acc < 500 or tot - acc - m < 500 else "mid"
        acc += m
        for f in feats(w):
            F[f"{pos}:{f}"][i] += m
names = sorted(F, key=lambda f: -np.sum(F[f] > 50))
print(f"{'признак':50s} {'n':>5s} {'Y(с)':>7s} {'Y(без)':>7s} {'Yt(с)':>7s} {'Yt(без)':>7s}")
for f in names:
    m = F[f] > 50
    if m.sum() < 8: continue
    print(f"{f:50s} {m.sum():5d} {y[m].mean():+7.3f} {y[~m].mean():+7.3f} {yt[m].mean():+7.3f} {yt[~m].mean():+7.3f}")
