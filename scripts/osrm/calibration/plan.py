"""План сбора эталона 2ГИС: блоки 10×10 пар в порядке ценности → plan.json.

python plan.py
Блоки: retest (повтор первого набора — повторяемость 2ГИС), short (внутри микрорайона),
adjacent (соседние микрорайоны, 3–8 км), peak (те же пары утром/вечером/ночью), random.
"""
import json, math, random

DAY, MORNING, EVENING, NIGHT = "2026-09-30T10:00:00Z", "2026-09-30T05:30:00Z", "2026-09-30T15:00:00Z", "2026-09-30T19:00:00Z"
pts = json.load(open("points.json"))
v1 = json.load(open("points.v1.json"))
by_id = {p["id"]: p for p in pts}


def km(a, b):
    return math.hypot((a["lat"] - b["lat"]) * 111.2, (a["lon"] - b["lon"]) * 78.6)


blocks = []

# 1. Повтор первого набора: те же выборки, что collect.py (seed 1 × 1 блок, seed 2 × 7 блоков).
for seed, n in [(1, 1), (2, 7)]:
    random.seed(seed)
    for _ in range(n):
        ch = random.sample(range(len(v1)), 20)
        blocks.append({"label": "day", "start": DAY, "kind": "retest",
                       "src": [v1[i]["id"] for i in ch[:10]], "dst": [v1[i]["id"] for i in ch[10:]]})

micros = [p for p in pts if p["kind"] == "micro"]
rnd = random.Random(929)
# Плотные районы — где больше всего точек рядом (больше коротких пар).
density = sorted(micros, key=lambda c: -sum(1 for p in pts if km(p, c) < 2.5))

# 2. Внутри микрорайона: 20 ближайших к центру точек, через одну — отправление и прибытие.
short = []
for c in density[:20]:
    near = sorted((p for p in pts if p["id"] != c["id"]), key=lambda p: km(p, c))[:20]
    short.append({"label": "day", "start": DAY, "kind": "short",
                  "src": [p["id"] for p in near[0::2]], "dst": [p["id"] for p in near[1::2]]})
blocks += short

# 3. Соседние микрорайоны: 10 точек у центра → 10 точек в 3–8 км от него.
adjacent = []
for c in rnd.sample(micros, 10):
    near = sorted(pts, key=lambda p: km(p, c))[:10]
    ring = [p for p in pts if 3 <= km(p, c) <= 8]
    if len(ring) < 10:
        continue
    adjacent.append({"label": "day", "start": DAY, "kind": "adjacent",
                     "src": [p["id"] for p in near], "dst": [p["id"] for p in rnd.sample(ring, 10)]})
blocks += adjacent

# 4. Час пик и ночь — на части коротких и соседних блоков (те же пары).
for label, start in [("morning", MORNING), ("evening", EVENING), ("night", NIGHT)]:
    for b in short[:2] + adjacent[:2]:
        blocks.append({**b, "label": label, "start": start, "kind": f"peak-{b['kind']}"})

# 5. Случайные по всей агломерации.
for _ in range(4):
    ch = rnd.sample(pts, 20)
    blocks.append({"label": "day", "start": DAY, "kind": "random", "src": [p["id"] for p in ch[:10]], "dst": [p["id"] for p in ch[10:]]})

for i, b in enumerate(blocks):
    b["id"] = i
json.dump(blocks, open("plan.json", "w"), ensure_ascii=False, indent=1)
from collections import Counter
print(len(blocks), "блоков,", len(blocks) * 100, "пар:", dict(Counter(b["kind"] for b in blocks)))
d = [km(by_id[s], by_id[t]) for b in blocks if b["kind"] == "short" for s in b["src"] for t in b["dst"]]
print(f"короткие: по прямой медиана {sorted(d)[len(d)//2]:.1f} км, 90% до {sorted(d)[int(len(d)*.9)]:.1f} км")
