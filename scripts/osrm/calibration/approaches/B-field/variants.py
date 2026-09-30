"""Сравнение вариантов выбора маршрута / привязки по CV времени на train (поле q ≡ 1 при сборке).
python variants.py <база json> <тег> '<json-правка>' …"""
import sys, json, copy
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from bf import *
from fit import Design, fit
day, split = data()
base, tag = json.load(open(sys.argv[1])), sys.argv[2]
G = grid(2.0); folds = point_folds(split)
def deep(d, u):
    for k, v in u.items():
        if isinstance(v, dict) and isinstance(d.get(k), dict): deep(d[k], v)
        else: d[k] = v
for n, mod in enumerate(sys.argv[3:]):
    p = copy.deepcopy(base); deep(p, json.loads(mod)); p["field"] = dict(G, q=[1.0] * (G["nx"] * G["ny"]))
    seg = build_and_route(f"{tag}{n}", p)
    tr = sorted(k for k in day if pair_part(k, split) == "train" and k in seg and "err" not in seg[k])
    D = Design(seg, day, tr, p, G, groups=[0, 0, 0, 1, 1, 1], lam_g=0.3); idx = {k: i for i, k in enumerate(tr)}
    P, Y, K = [], [], []
    for f in folds:
        a = [idx[k] for k in tr if k[0] not in f and k[1] not in f]; b = [idx[k] for k in tr if k[0] in f or k[1] in f]
        x = fit(D, a, 0.1, 0.01); P.append(D.predict(x, np.array(b))); Y.append(D.y[b]); K.append(D.km[b])
    pr, y, km = map(np.concatenate, (P, Y, K)); bal, e = balanced(pr, y, km)
    ks = km_score(seg, day, tr)
    print(f"{tag}{n} {mod}: CV {bal*100:.2f}%", [round(float(e[(km>=lo)&(km<hi)].mean())*100, 1) for lo, hi in BUCKETS],
          f"km med {ks[0]*100:.2f}% clip {ks[2]*100:.2f}%", flush=True)
