"""Итерации «граф → маршруты → подбор поля» (только train; λ — перекрёстной проверкой по группам точек).

python loop_b.py <стартовые params json> <тег> <итераций> [--step 3] [--lams 0.03,0.1,0.3] [--lamr 0.03,0.1,0.3]
Версия <тег>i: params → граф → seg → подбор (c, q, α, γ, β) → params <тег>(i+1).
Скорости выбора маршрута (route_speeds) не меняются: поле и скорости классов влияют только на время.
"""
import sys, json, copy
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from bf import *
from fit import Design, fit, NC


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


day, split = data()
p = json.load(open(sys.argv[1]))
tag, n_iter = sys.argv[2], int(sys.argv[3])
step = float(arg("--step", "3"))
groups = [int(g) for g in arg("--groups", "0,0,0,0,0,0").split(",")]
lam_g = float(arg("--lamg", "0"))
lams = [float(x) for x in arg("--lams", "0.03,0.1,0.3").split(",")]
lamr = [float(x) for x in arg("--lamr", "0.03,0.1,0.3").split(",")]
G = grid(step)
folds = point_folds(split)
log = []
for it in range(n_iter):
    ver = f"{tag}{it}"
    seg = build_and_route(ver, p)
    tr = sorted(k for k in day if pair_part(k, split) == "train" and k in seg and "err" not in seg[k])
    y = np.array([day[k]["s"] for k in tr]); km = np.array([day[k]["m"] / 1000 for k in tr])
    osrm = np.array([seg[k]["s"] for k in tr])
    b_in, _ = balanced(osrm + p.get("beta", 23), y, km)
    D = Design(seg, day, tr, p, G, groups=groups if max(groups) else None, lam_g=lam_g)
    idx = {k: i for i, k in enumerate(tr)}
    best = None
    for ls in lams:
        for lr in lamr:
            P, Y, K = [], [], []
            for f in folds:
                a = [idx[k] for k in tr if k[0] not in f and k[1] not in f]
                bb = [idx[k] for k in tr if k[0] in f or k[1] in f]
                x = fit(D, a, ls, lr)
                P.append(D.predict(x, np.array(bb))); Y.append(D.y[bb]); K.append(D.km[bb])
            cvb, e = balanced(*map(np.concatenate, (P, Y, K)))
            if best is None or cvb < best[0]:
                best = (cvb, ls, lr)
    cvb, ls, lr = best
    x = fit(D, np.arange(len(tr)), ls, lr)
    c, q, a, g, beta = x
    print(f"{ver}: train как есть (β={p.get('beta', 23):.0f}) {b_in*100:.2f}% | CV {cvb*100:.2f}% λs={ls} λr={lr} | "
          f"км {km_score(seg, day, tr)[0]*100:.2f}% | c={np.round(c, 3).tolist()} α={a:.3f} γ={g:.2f} β={beta:.1f}", flush=True)
    log.append({"ver": ver, "train_asis": b_in, "cv": cvb, "lam_s": ls, "lam_r": lr, "c": c.tolist(), "alpha": a, "gamma": g, "beta": beta})
    nxt = copy.deepcopy(p)
    nxt["speeds"] = {cl: p["speeds"][cl] / c[i] for i, cl in enumerate(CLASSES)}
    n1 = G["nx"] * G["ny"]
    nxt["field"] = dict(G, q=[float(v) for v in q[:n1]])
    if max(groups):
        nxt["field"].update(q2=[float(v) for v in q[n1:2 * n1]], groups=groups)
    for k in ("turn_penalty", "signal_penalty", "u_turn_penalty"):
        nxt[k] = p[k] * a
    nxt["intersection_penalty"] = max(0.0, p["intersection_penalty"] * a + g)
    nxt["beta"] = float(beta)
    p = nxt
    json.dump(p, open(f"approaches/{PREFIX}/params_{tag}{it + 1}.json", "w"), ensure_ascii=False)
json.dump(log, open(f"approaches/{PREFIX}/loop_{tag}.json", "w"), indent=1)
# последняя версия: граф с итоговыми параметрами и её оценка на train как есть
ver = f"{tag}{n_iter}"
seg = build_and_route(ver, p)
tr = sorted(k for k in day if pair_part(k, split) == "train" and k in seg and "err" not in seg[k])
y = np.array([day[k]["s"] for k in tr]); km = np.array([day[k]["m"] / 1000 for k in tr])
b_in, e = balanced(np.array([seg[k]["s"] for k in tr]) + p["beta"], y, km)
print(f"{ver}: train как есть {b_in*100:.2f}% (β={p['beta']:.1f})", [round(e[(km >= lo) & (km < hi)].mean() * 100, 1) for lo, hi in BUCKETS])
