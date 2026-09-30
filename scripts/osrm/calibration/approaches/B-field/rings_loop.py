"""Для сравнения: те же маршруты (route_speeds, привязка), но время — класс × 3 кольца (как рабочий профиль,
без поправок улиц), подбор на train тем же методом. python rings_loop.py <старт json> <тег> <итераций>"""
import sys, json, copy
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from bf import *
from fit import Design, fit, NC
from scipy import sparse
day, split = data()
p = json.load(open(sys.argv[1])); tag, n_iter = sys.argv[2], int(sys.argv[3])
p.pop("field", None)
CEN = (45.0355, 38.9753); ZN = ["core", "city", "outer"]
def ring(lon, lat):
    d = np.hypot((lon - CEN[1]) * KM_LON, (lat - CEN[0]) * KM_LAT)
    return np.where(d <= 3, 0, np.where(d <= 8, 1, 2))
for it in range(n_iter + 1):
    seg = build_and_route(f"{tag}{it}", p)
    tr = sorted(k for k in day if pair_part(k, split) == "train" and k in seg and "err" not in seg[k])
    y = np.array([day[k]["s"] for k in tr]); km = np.array([day[k]["m"] / 1000 for k in tr])
    print(f"{tag}{it}: train как есть {balanced(np.array([seg[k]['s'] for k in tr]) + p.get('beta', 23), y, km)[0]*100:.2f}%", flush=True)
    if it == n_iter:
        break
    D = Design(seg, day, tr, {}, grid(3.0))
    W = [sparse.lil_matrix((len(tr), 3 * NC)) for _ in range(NC)]
    for i, k in enumerate(tr):
        S = np.array(seg[k]["seg"], float)
        for rr, bb, c in zip(ring(S[:, 0], S[:, 1]), S[:, 3], S[:, 4].astype(int)):
            W[c][i, c * 3 + rr] += bb
    D.W = [w.tocsr() for w in W]; D.nn = 3 * NC; D.D = sparse.csr_matrix((1, 3 * NC)); D.n_edge_rows = 1
    c, q, a, g, beta = fit(D, np.arange(len(tr)), 0, 0.03)
    cur = p.get("zone_speeds") or {cl: {z: p["speeds"][cl] for z in ZN} for cl in CLASSES}
    p = copy.deepcopy(p)
    p["zone_speeds"] = {cl: {z: cur[cl][z] / (c[i] * q[i * 3 + j]) for j, z in enumerate(ZN)} for i, cl in enumerate(CLASSES)}
    # rate_factors считаются от speeds; выбор маршрута держим прежним: speeds не трогаем, а zone_speeds
    # в Lua заменяют скорость — поправим route_speeds так, чтобы вес не зависел от колец: см. README
    for k in ("turn_penalty", "signal_penalty", "u_turn_penalty"):
        p[k] *= a
    p["intersection_penalty"] = max(0.0, p["intersection_penalty"] * a + g)
    p["beta"] = float(beta)
    print("   zone_speeds", {cl: {z: round(v, 1) for z, v in d.items()} for cl, d in p["zone_speeds"].items()}, "β", round(beta, 1), flush=True)
json.dump(p, open(f"approaches/{PREFIX}/params_{tag}_final.json", "w"), ensure_ascii=False)
