"""Подбор выбора маршрута (route_speeds, route_turn, turn_weight_extra) по точности ВРЕМЕНИ.

python route_search2.py <база params json> <тег> [раундов]
Для кандидата: граф с полем q ≡ 1 → маршруты train → перекрёстная проверка подбора поля по группам
точек (λ фиксированы) → цель = CV min_balanced + 0,2 · средняя min(|ошибка км|, 50%). Только train.
"""
import sys, json, copy
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from bf import *
from fit import Design, fit
day, split = data()
base, tag = sys.argv[1], sys.argv[2]
rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 3
LS, LR, STEP = 0.1, 0.01, 2.0
p = json.load(open(base))
G = grid(STEP)
p["field"] = dict(G, q=[1.0] * (G["nx"] * G["ny"]))
folds = point_folds(split)
n = 0
cache = {}


def cvscore(seg):
    tr = sorted(k for k in day if pair_part(k, split) == "train" and k in seg and "err" not in seg[k])
    D = Design(seg, day, tr, p, G, groups=[0, 0, 0, 1, 1, 1], lam_g=0.3)
    idx = {k: i for i, k in enumerate(tr)}
    P, Y, K = [], [], []
    for f in folds:
        a = [idx[k] for k in tr if k[0] not in f and k[1] not in f]
        b = [idx[k] for k in tr if k[0] in f or k[1] in f]
        x = fit(D, a, LS, LR, rounds=6)
        P.append(D.predict(x, np.array(b))); Y.append(D.y[b]); K.append(D.km[b])
    pr, y, km = map(np.concatenate, (P, Y, K))
    bal, e = balanced(pr, y, km)
    return bal, [e[(km >= lo) & (km < hi)].mean() for lo, hi in BUCKETS], km_score(seg, day, tr)


def ev(q):
    global n
    key = json.dumps([q["route_speeds"], q["route_turn"], q.get("turn_weight_extra", 0)], sort_keys=True)
    if key in cache:
        return cache[key]
    n += 1
    seg = build_and_route(f"{tag}{n}", q)
    bal, bk, kms = cvscore(seg)
    obj = bal + 0.2 * kms[2]
    cache[key] = obj
    print(n, json.dumps({c: round(v, 1) for c, v in q["route_speeds"].items()}), json.dumps({c: round(v, 1) for c, v in q["route_turn"].items()}),
          "tw %.1f" % q.get("turn_weight_extra", 0), "| CV %.2f%%" % (bal * 100), [round(v * 100, 1) for v in bk],
          "km med %.2f%% clip %.2f%% | obj %.4f" % (kms[0] * 100, kms[2] * 100, obj), flush=True)
    return obj


best = ev(p)
knobs = [("route_speeds", c) for c in CLASSES if c != "primary"] + [("route_turn", t) for t in ("turn", "u_turn", "intersection", "signal")] + [("tw", None)]
step = float(os.environ.get("RS_STEP", "1.35"))
for r in range(rounds):
    improved = False
    for kind, c in knobs:
        for d in (step, 1 / step):
            q = copy.deepcopy(p)
            if kind == "tw":
                q["turn_weight_extra"] = max(0.0, (q.get("turn_weight_extra", 0) + 2) * d - 2)
            else:
                q[kind][c] = max(q[kind][c], 0.5) * d
            s = ev(q)
            if s < best - 2e-4:
                p, best, improved = q, s, True
                break
    json.dump(p, open(f"approaches/{PREFIX}/route_{tag}.json", "w"), ensure_ascii=False)
    if not improved:
        step = step ** 0.5
        if step < 1.07:
            break
print("best", best, json.dumps(p["route_speeds"]), json.dumps(p["route_turn"]), p.get("turn_weight_extra"))
