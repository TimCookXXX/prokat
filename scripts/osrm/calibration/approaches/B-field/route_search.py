"""Подбор «скоростей выбора маршрута» (вес OSRM) по совпадению км с 2ГИС на train.

python route_search.py <база params json> <тег> [раундов=3]
Цель — средняя min(|ошибка км|, 50%) на train-парах; время (duration) от этих параметров не зависит.
"""
import sys, json, copy
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from bf import *
day, split = data()
base, tag = sys.argv[1], sys.argv[2]
rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 3
p = json.load(open(base))
tr = sorted(k for k in day if pair_part(k, split) == "train")
n = 0
cache = {}
def ev(p):
    global n
    key = json.dumps([p["route_speeds"], p.get("turn_weight_extra", 0)], sort_keys=True)
    if key in cache: return cache[key]
    n += 1
    seg = build_and_route(f"{tag}{n}", p)
    s = km_score(seg, day, tr)
    cache[key] = s
    print(n, json.dumps({c: round(v, 1) for c, v in p["route_speeds"].items()}), "tw", round(p.get("turn_weight_extra", 0), 1),
          "km med %.2f%% mean %.2f%% clip %.2f%%" % (s[0]*100, s[1]*100, s[2]*100), flush=True)
    return s
best = ev(p)
knobs = [("route_speeds", c) for c in CLASSES if c != "primary"] + [("turn_weight_extra", None)]
step = 1.3
for r in range(rounds):
    improved = False
    for kind, c in knobs:
        for d in (step, 1 / step):
            q = copy.deepcopy(p)
            if kind == "route_speeds":
                q["route_speeds"][c] *= d
            else:
                q["turn_weight_extra"] = (q.get("turn_weight_extra", 0) + 3) * d - 3 if d > 1 else max(0, (q.get("turn_weight_extra", 0) + 3) * d - 3)
            s = ev(q)
            if s[2] < best[2] - 1e-4:
                p, best, improved = q, s, True
                break
    json.dump(p, open(f"approaches/B-field/route_{tag}.json", "w"), ensure_ascii=False)
    if not improved:
        step = step ** 0.5
        if step < 1.06: break
print("best", best, json.dumps(p["route_speeds"]), p.get("turn_weight_extra"))
