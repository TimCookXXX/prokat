#!/usr/bin/env python3
"""Промахи из отчёта run_eval.py: python misses.py report.<name>.v1big.train.jsonl [сценарий] [--lenient] [--n 40]"""
import json, sys, os
path = sys.argv[1]
if not os.path.exists(path):
    path = os.path.join(os.path.dirname(__file__), "../../data/geocoder/search-eval", path)
argv = sys.argv[2:]
if "--n" in argv:
    del argv[argv.index("--n") + 1]
sc = next((a for a in argv if not a.startswith("--")), None)
lenient = "--lenient" in sys.argv
n = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 40
rows = [json.loads(l) for l in open(path)]
shown = 0
for r in rows:
    if r["holdout"] != "none" or (sc and r["scenario"] != sc):
        continue
    ok = (r["rank_l"] if lenient else r["rank"])
    if ok == 1:
        continue
    e = r["expect"]
    print(f"[{r['scenario']}] {r['query']!r}  → ждали {e['settlement']} · {e['street']} · {e['hn']}  rank={r['rank']} rank_l={r['rank_l']}")
    for t in r["top"][:3]:
        print(f"      {t.get('settlement')} · {t.get('title')} ({t['level']}, {t['score']})")
    shown += 1
    if shown >= n:
        break
