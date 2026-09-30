"""Оценка прогноза на парах «выбора модели» (val) — единая для всех подходов.

python score_val.py <pred.json> [--part val|train] [--label day]
pred.json: {"src|dst": [км, минуты], …} — прогноз для пар (типичное время на метку label).
Печатает метрики и пишет <pred>.score.json. Контрольные пары здесь недоступны (vault/).
"""
import json, sys
from evalkit import fmt, load_work, pair_part, score

pred_file = sys.argv[1]
part = sys.argv[sys.argv.index("--part") + 1] if "--part" in sys.argv else "val"
label = sys.argv[sys.argv.index("--label") + 1] if "--label" in sys.argv else "day"
ref, split = load_work()
ref = ref[label]
keys = [k for k in ref if pair_part(k, split) == part]
raw = json.load(open(pred_file))
pred = {tuple(k.split("|")): v for k, v in raw.items()}
s = score(pred, ref, keys)
print(f"{pred_file} [{part}, {label}]: {fmt(s)}")
json.dump(s, open(pred_file.replace(".json", "") + f".{part}.{label}.score.json", "w"), indent=1)
