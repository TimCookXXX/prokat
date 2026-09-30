import sys, json
sys.path.insert(0, __file__.rsplit('/',1)[0])
from bf import *
from fit import Design, fit
day, split = data()
ver = sys.argv[1]
seg = load_seg(ver); p_cur = json.load(open(f"approaches/B-field/params_{ver}.json"))
tr = sorted(k for k in day if pair_part(k, split) == "train" and k in seg and "err" not in seg[k])
folds = point_folds(split); idx = {k: i for i, k in enumerate(tr)}
def cvb(D, ls, lr, **kw):
    P, Y, K = [], [], []
    for f in folds:
        a = [idx[k] for k in tr if k[0] not in f and k[1] not in f]; b = [idx[k] for k in tr if k[0] in f or k[1] in f]
        x = fit(D, a, ls, lr, **kw); P.append(D.predict(x, np.array(b))); Y.append(D.y[b]); K.append(D.km[b])
    p, y, km = map(np.concatenate, (P, Y, K)); bal, e = balanced(p, y, km)
    return round(bal*100,2), [round(float(e[(km>=lo)&(km<hi)].mean())*100,1) for lo,hi in BUCKETS]
for spec in sys.argv[2:]:
    st, grp, lg, ls, lr, *qb = spec.split(":")
    groups = None if grp == "1" else ([0,0,0,1,1,1] if grp == "2" else ([0,0,1,1,2,2] if grp == "3" else [int(ch) for ch in grp]))
    D = Design(seg, day, tr, p_cur, grid(float(st)), groups=groups, lam_g=float(lg))
    print(spec, cvb(D, float(ls), float(lr), **({"q_bounds": (float(qb[0]), float(qb[1]))} if qb else {})), flush=True)
