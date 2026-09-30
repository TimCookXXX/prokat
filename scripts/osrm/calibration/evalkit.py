"""Общий протокол калибровки: эталон, разбиение по точкам, метрики.

Эталон — gis2.jsonl (второй сеанс сбора, согласованный): label → {(src, dst): {"m", "s"}}.
Разбиение точек 60/20/20 (обучение / выбор модели / контроль), стратифицировано по виду точки;
пара попадает в «контроль», если хоть один конец контрольный, в «выбор» — если хоть один конец
из выбора (и ни одного контрольного), иначе — в «обучение». Контрольные пары лежат в vault/ и
читаются только итоговой проверкой (final_check.py), подходы их не видят.

python evalkit.py split      — сделать split.json и work/ + vault/ (один раз, после сбора)
python evalkit.py noise      — повторяемость 2ГИС (первый сеанс против второго на тех же парах)
"""
import json, math, os, random, sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKETS = [(0, 3), (3, 7), (7, 15), (15, 1e9)]


def load_points():
    return {p["id"]: p for p in json.load(open("points.json"))}


def load_jsonl(path):
    ref = defaultdict(dict)
    for r in map(json.loads, open(path)):
        if r["m"] is None or r["m"] < 300:  # одна и та же точка / соседние дома — не маршрут
            continue
        ref[r["label"]][(r["src"], r["dst"])] = {"m": r["m"], "s": r["s"]}
    return ref


def load_work():
    """Обучение и выбор модели (без контроля): label → пары, и назначение пары."""
    ref = load_jsonl("work/train_val.jsonl")
    split = json.load(open("split.json"))
    return ref, split


def pair_part(k, split):
    a, b = split["point"][k[0]], split["point"][k[1]]
    if "test" in (a, b):
        return "test"
    if "val" in (a, b):
        return "val"
    return "train"


def make_split():
    pts = load_points()
    rnd = random.Random(20260929)
    by_kind = defaultdict(list)
    for pid, p in sorted(pts.items()):
        by_kind[p["kind"]].append(pid)
    part = {}
    for kind, ids in by_kind.items():
        rnd.shuffle(ids)
        n = len(ids)
        n_test, n_val = round(n * 0.2), round(n * 0.2)
        for i, pid in enumerate(ids):
            part[pid] = "test" if i < n_test else "val" if i < n_test + n_val else "train"
    split = {"point": part}
    json.dump(split, open("split.json", "w"), ensure_ascii=False, indent=1)
    os.makedirs("work", exist_ok=True)
    os.makedirs("vault", exist_ok=True)
    tv, te = open("work/train_val.jsonl", "w"), open("vault/test.jsonl", "w")
    counts = defaultdict(int)
    for r in map(json.loads, open("gis2.jsonl")):
        pp = pair_part((r["src"], r["dst"]), split)
        counts[(r["label"], pp)] += 1
        (te if pp == "test" else tv).write(json.dumps(r, ensure_ascii=False) + "\n")
    tv.close(), te.close()
    for k in sorted(counts):
        print(k, counts[k])


def rel_err(pred, true):
    return abs(pred - true) / true


def score(pred, ref, keys, pts=None):
    """pred: {(src,dst): (km, minutes)}; ref: {(src,dst): {"m","s"}}. Метрики по минутам и км."""
    rows = [(k, pred[k], ref[k]) for k in keys if k in pred and pred[k] is not None]
    if not rows:
        return {"n": 0}
    em = np.array([rel_err(p[1] * 60, r["s"]) for _, p, r in rows])
    ek = np.array([rel_err(p[0] * 1000, r["m"]) for _, p, r in rows])
    km_true = np.array([r["m"] / 1000 for _, _, r in rows])
    out = {
        "n": len(rows), "missing": len(keys) - len(rows),
        "min_mean": float(em.mean()), "min_median": float(np.median(em)), "min_p90": float(np.percentile(em, 90)),
        "min_within10": float(np.mean(em <= 0.1)), "min_within20": float(np.mean(em <= 0.2)),
        "km_median": float(np.median(ek)), "km_p90": float(np.percentile(ek, 90)), "km_within5": float(np.mean(ek <= 0.05)),
        "buckets": {},
    }
    bal = []
    for lo, hi in BUCKETS:
        m = (km_true >= lo) & (km_true < hi)
        if m.sum():
            out["buckets"][f"{lo}-{hi if hi < 1e8 else ''}"] = {"n": int(m.sum()), "min_mean": float(em[m].mean()),
                                                                 "min_median": float(np.median(em[m])), "km_median": float(np.median(ek[m]))}
            bal.append(em[m].mean())
    out["min_balanced"] = float(np.mean(bal))  # главная метрика: средняя по диапазонам длины
    return out


def fmt(s):
    if not s.get("n"):
        return "нет пар"
    b = "  ".join(f"{k} км: {v['min_mean']*100:.1f}% (n={v['n']})" for k, v in s["buckets"].items())
    return (f"МИН сбаланс. {s['min_balanced']*100:.1f}% | средняя {s['min_mean']*100:.1f}% медиана {s['min_median']*100:.1f}% "
            f"90% в {s['min_p90']*100:.1f}% ≤10% {s['min_within10']*100:.0f}% ≤20% {s['min_within20']*100:.0f}% | "
            f"КМ медиана {s['km_median']*100:.1f}% 90% в {s['km_p90']*100:.1f}% ≤5% {s['km_within5']*100:.0f}% | n={s['n']}\n    {b}")


def noise():
    s1 = load_jsonl("gis.jsonl")["day"]
    s2 = load_jsonl("gis2.jsonl")["day"]
    common = [k for k in s1 if k in s2]
    em = np.array([rel_err(s1[k]["s"], s2[k]["s"]) for k in common])
    ek = np.array([rel_err(s1[k]["m"], s2[k]["m"]) for k in common])
    print(f"Повторяемость 2ГИС (13:00, тот же запрос двумя сеансами), пар {len(common)}:")
    print(f"  минуты: медиана расхождения {np.median(em)*100:.1f}%, средняя {em.mean()*100:.1f}%, 90% в {np.percentile(em,90)*100:.1f}%")
    print(f"  км:     медиана {np.median(ek)*100:.1f}%, совпали до метра {np.mean(ek==0)*100:.0f}%, 90% в {np.percentile(ek,90)*100:.1f}%")


if __name__ == "__main__":
    {"split": make_split, "noise": noise}[sys.argv[1]]()
