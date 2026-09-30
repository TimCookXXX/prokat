"""Поле против колец на одних и тех же маршрутах (train, CV по группам точек): где выигрывает поле.
python compare_models.py <версия маршрутов с q≡1>"""
import sys, json, copy
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from bf import *
from fit import Design, fit, NC
from scipy import sparse
day, split = data()
ver = sys.argv[1]
seg = load_seg(ver); p = json.load(open(f"approaches/{PREFIX}/params_{ver}.json"))
tr = sorted(k for k in day if pair_part(k, split) == "train")
folds = point_folds(split); idx = {k: i for i, k in enumerate(tr)}
CEN = (45.0355, 38.9753)
def ring(lon, lat):
    d = np.hypot((lon - CEN[1]) * KM_LON, (lat - CEN[0]) * KM_LAT)
    return np.where(d <= 3, 0, np.where(d <= 8, 1, 2))
def ringD(per_class):
    D = Design(seg, day, tr, p, grid(3.0))
    n = len(tr); nn = 3 * (NC if per_class else 1)
    W = [sparse.lil_matrix((n, nn)) for _ in range(NC)]
    for i, k in enumerate(tr):
        S = np.array(seg[k]["seg"], float)
        for rr, bb, c in zip(ring(S[:, 0], S[:, 1]), S[:, 3], S[:, 4].astype(int)):
            W[c][i, (c * 3 if per_class else 0) + rr] += bb
    D.W = [w.tocsr() for w in W]; D.nn = nn; D.D = sparse.csr_matrix((1, nn)); D.n_edge_rows = 1
    return D
def cvpred(D, ls, lr, **kw):
    pred = np.zeros(len(tr))
    for f in folds:
        a = [idx[k] for k in tr if k[0] not in f and k[1] not in f]; b = [idx[k] for k in tr if k[0] in f or k[1] in f]
        pred[b] = D.predict(fit(D, a, ls, lr, **kw), np.array(b))
    return pred
models = {
    "без зон (только классы)": cvpred(Design(seg, day, tr, p, grid(3.0)), 1, 1, fix_field=True),
    "3 кольца": cvpred(ringD(False), 0, 0.03),
    "класс × 3 кольца": cvpred(ringD(True), 0, 0.03),
    "поле 3 км, одно": cvpred(Design(seg, day, tr, p, grid(3.0)), 0.1, 0.03),
    "поле 2 км, магистрали/прочие": cvpred(Design(seg, day, tr, p, grid(2.0), groups=[0, 0, 0, 1, 1, 1], lam_g=0.3), 0.1, 0.01),
}
y = np.array([day[k]["s"] for k in tr]); km = np.array([day[k]["m"] / 1000 for k in tr])
# категории пар
share = []
for k in tr:
    S = np.array(seg[k]["seg"], float); r = ring(S[:, 0], S[:, 1])
    share.append([S[r == z, 2].sum() / S[:, 2].sum() for z in range(3)])
share = np.array(share)
ADY = {"s:Яблоновский", "s:Новая Адыгея", "s:Энем", "s:Козет"}
cats = {
    "маршрут в основном в центре (≤3 км)": share[:, 0] >= 0.5,
    "в основном город (3–8 км)": share[:, 1] >= 0.5,
    "в основном окраины (>8 км)": share[:, 2] >= 0.5,
    "через Кубань (Адыгея)": np.array([(k[0] in ADY) != (k[1] in ADY) for k in tr]),
}
for lo, hi in BUCKETS:
    cats[f"{lo}–{hi if hi < 1e8 else ''} км"] = (km >= lo) & (km < hi)
out = {}
print(f"{'':40s}" + "".join(f"{m[:22]:>24s}" for m in models))
print(f"{'min_balanced':40s}" + "".join(f"{balanced(pr, y, km)[0]*100:24.1f}" for pr in models.values()))
for c, m in cats.items():
    row = {name: float(np.mean(np.abs(pr[m] - y[m]) / y[m])) for name, pr in models.items()}
    out[c] = {"n": int(m.sum()), **row}
    print(f"{c + f' (n={m.sum()})':40s}" + "".join(f"{v*100:24.1f}" for v in row.values()))
out["min_balanced"] = {name: balanced(pr, y, km)[0] for name, pr in models.items()}
json.dump(out, open(f"approaches/{PREFIX}/compare_models.json", "w"), ensure_ascii=False, indent=1)
