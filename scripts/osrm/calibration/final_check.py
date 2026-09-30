"""Итоговая проверка на контрольных парах (vault/test.jsonl) — один раз, в конце.

python final_check.py <pred_base.json> <pred_new.json> [label=day]
Прогнозы — для пар vault/test.jsonl ({"src|dst": [км, минуты]}). Печатает метрики обоих и JSON-итог.
"""
import json, sys
from evalkit import fmt, load_jsonl, score

base, new = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
label = sys.argv[3] if len(sys.argv) > 3 else "day"
ref = load_jsonl("vault/test.jsonl")[label]
keys = sorted(ref)
res = {}
for name, raw in [("base", base), ("new", new)]:
    pred = {tuple(k.split("|")): v for k, v in raw.items()}
    res[name] = score(pred, ref, keys)
    print(f"{name}: {fmt(res[name])}")
json.dump(res, open(f"final_check.{label}.json", "w"), indent=1)
