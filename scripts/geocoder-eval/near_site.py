#!/usr/bin/env python3
"""Подсказки с местом пользователя так, как его передаёт сайт (только val; контрольную часть не трогает).

final_metrics.py и scenarios.ts считают «у точки пользователя» с near = цель + (0,0064; 0,009), ≈ 1 км от
ответа. Это оракул: сайт такой точки не знает. WhereField передаёт near только так:
  - прошлый выбор — точка (адрес или геолокация) или центр выбранного микрорайона Краснодара;
  - иначе null → движок берёт центр Краснодара (колонка «топ-1» в final_metrics).
Здесь — ближайший к цели центр микрорайона Краснодара из справочника сайта (geo-data.ts): человек раньше
выбрал свой микрорайон. Для целей вне Краснодара это центр ближайшего городского микрорайона — сайт других не
знает. Для сравнения — те же запросы без места и с оракулом.

  pnpm exec tsx scripts/geocoder-eval/serve.ts --index data/geocoder/build/index.krasnodar.eval.data.json &
  python scripts/geocoder-eval/near_site.py [val]
"""
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
EVAL = os.path.join(ROOT, "data/geocoder/research/eval")
sys.path.insert(0, EVAL)
sys.path.insert(0, HERE)

import evaluate as ev  # noqa: E402
from final_metrics import group, rank_of, pct  # noqa: E402

split = sys.argv[1] if len(sys.argv) > 1 else "val"
if split != "val":
    sys.exit("только val: контрольная часть уже замерена на этапе Final")
HTTP = os.environ.get("EVAL_HTTP", "http://127.0.0.1:8765")

md = json.loads(subprocess.check_output(
    ["pnpm", "exec", "tsx", "-e",
     "import { CITY_GEO } from './src/lib/compare/geo-data'; "
     "console.log(JSON.stringify(CITY_GEO.find((c) => c.citySlug === 'krasnodar')!.microdistricts.map((m) => [m.lat, m.lon])))"],
    cwd=ROOT, text=True).strip().splitlines()[-1])


def nearest_md(lat, lon):
    return min(md, key=lambda p: (p[0] - lat) ** 2 + ((p[1] - lon) * math.cos(math.radians(lat))) ** 2)


import requests  # noqa: E402
s = requests.Session()


def suggest(q, near=None):
    p = {"q": q, "k": 5}
    if near:
        p["near"] = f"{near[0]},{near[1]}"
    return s.get(f"{HTTP}/suggest", params=p, timeout=10).json() or []


rows = [json.loads(l) for l in open(os.path.join(EVAL, "out", f"queries.v1big.{split}.jsonl"))]
res = []
for r in rows:
    if r["holdout"] != "none":
        continue
    e = r["expect"]
    g = group(r)
    if g == "улица без номера":
        continue
    m = nearest_md(e["lat"], e["lon"])
    res.append({
        "r": r, "g": g,
        "c": rank_of(suggest(r["query"]), r),
        "m": rank_of(suggest(r["query"], m), r),
        "o": rank_of(suggest(r["query"], (e["lat"] + 0.0064, e["lon"] + 0.009)), r),
    })

subsets = [("все", lambda x: True),
           ("однозначные", lambda x: x["r"]["meta"]["settlement_in_query"] or not x["r"]["meta"]["ambiguous_without_settlement"]),
           ("неоднозначные без пункта", lambda x: not x["r"]["meta"]["settlement_in_query"] and x["r"]["meta"]["ambiguous_without_settlement"]),
           ("Краснодар", lambda x: x["r"]["meta"]["stratum"] == "krd")]
L = [f"### Топ-1 с местом пользователя, как его передаёт сайт — {split}", "",
     "| группа · срез | n | без места (центр города) | центр ближайшего микрорайона | оракул ≈1 км от цели |",
     "|---|---|---|---|---|"]
for g in ["чистые", "искажённые"]:
    for name, f in subsets:
        xs = [x for x in res if x["g"] == g and f(x)]
        n = len(xs)
        L.append(f"| {g} · {name} | {n} | {pct(sum(x['c'] == 1 for x in xs), n)} | {pct(sum(x['m'] == 1 for x in xs), n)} | "
                 f"{pct(sum(x['o'] == 1 for x in xs), n)} |")
print("\n".join(L))
out = os.path.join(ROOT, "data/geocoder/search-eval", f"near-site.v1big.{split}.md")
open(out, "w").write("\n".join(L) + "\n")
