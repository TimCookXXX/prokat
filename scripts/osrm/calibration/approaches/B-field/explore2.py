import sys, time, json
sys.path.insert(0, __file__.rsplit('/',1)[0])
from bf import *
from fit import Design, fit, cv, NC
from scipy import sparse
day, split = data()
ver = sys.argv[1]
seg = load_seg(ver)
p_cur = json.load(open(f"approaches/B-field/params_{ver}.json"))
tr = sorted(k for k in day if pair_part(k, split) == "train" and k in seg and "err" not in seg[k])
folds = point_folds(split)
idx = {k: i for i, k in enumerate(tr)}
def cvb(D, ls, lr, **kw):
    P, Y, K = [], [], []
    for f in folds:
        a = [idx[k] for k in tr if k[0] not in f and k[1] not in f]; b = [idx[k] for k in tr if k[0] in f or k[1] in f]
        x = fit(D, a, ls, lr, **kw); P.append(D.predict(x, np.array(b))); Y.append(D.y[b]); K.append(D.km[b])
    p, y, km = map(np.concatenate, (P, Y, K)); bal, e = balanced(p, y, km)
    return round(bal*100,2), [round(e[(km>=lo)&(km<hi)].mean()*100,1) for lo,hi in BUCKETS]
G = grid(3.0)
D = Design(seg, day, tr, p_cur, G)
print("no field", cvb(D, 1, 1, fix_field=True))
print("field 3km", cvb(D, 0.1, 0.1))
# rings: replace W by ring membership (3 nodes) for class-independent and class×ring
CENTER = (45.0355, 38.9753)
def ring(lon, lat):
    d = np.hypot((lon-CENTER[1])*KM_LON, (lat-CENTER[0])*KM_LAT)
    return np.where(d <= 3, 0, np.where(d <= 8, 1, 2))
class RingD(Design):
    def __init__(s, per_class):
        s.__dict__.update(D.__dict__)
        n = len(tr); nn = 3 * (NC if per_class else 1); s.nn = nn
        W = [sparse.lil_matrix((n, nn)) for _ in range(NC)]
        for i, k in enumerate(tr):
            S = np.array(seg[k]["seg"], float)
            if not len(S): continue
            r = ring(S[:,0], S[:,1]); b = S[:,3] / field_at(p_cur, S[:,0], S[:,1])
            for rr, bb, c in zip(r, b, S[:,4].astype(int)):
                W[c][i, (c*3 if per_class else 0) + rr] += bb
        s.W = [w.tocsr() for w in W]
        s.D = sparse.csr_matrix((1, nn))
print("rings", cvb(RingD(False), 0, 0.1))
print("class x rings", cvb(RingD(True), 0, 0.1))
print("class x rings lr .01", cvb(RingD(True), 0, 0.01))
x = fit(D, np.arange(len(tr)), 0.1, 0.1)
print("full fit: c", np.round(x[0],3), "alpha %.3f gamma %.2f beta %.1f" % x[2:], "q range", x[1].min(), x[1].max())
