"""Итоговый отчёт с разбиением по ТОЧКАМ (как fit3.py): проверка — пары, где хотя бы один конец
не участвовал в подборе. Минуты = f · время_OSRM + β, f и β — по обучающим парам.
python honest_eval.py v1 vavg vroads …
"""
import json, random, sys, urllib.request
import numpy as np
from scipy.optimize import minimize

gis = {(r["src"], r["dst"]): r for r in map(json.loads, open("gis.jsonl")) if r["label"] == "day" and r["m"] >= 300}
pts = {p["id"]: p for p in json.load(open("points.json"))}


def report(name, s_of, m_of, keys):
    points = sorted({p for k in keys for p in k})
    test_pts = set(random.Random(7).sample(points, len(points) // 5))
    tr = [k for k in keys if k[0] not in test_pts and k[1] not in test_pts]
    te = [k for k in keys if k[0] in test_pts or k[1] in test_pts]
    S = lambda ks: np.array([s_of(k) for k in ks]); T = lambda ks: np.array([gis[k]["s"] for k in ks], float)
    f, b = minimize(lambda p: np.mean(np.abs(p[0] * S(tr) + p[1] - T(tr)) / T(tr)), [1, 0], method="Nelder-Mead").x
    e = np.abs(f * S(te) + b - T(te)) / T(te)
    km = np.array([abs(m_of(k) - gis[k]["m"]) / gis[k]["m"] for k in keys])
    short = [k for k in te if gis[k]["m"] < 10000]
    es = np.abs(f * S(short) + b - T(short)) / T(short)
    print(f"{name:34s} МИН медиана {np.median(e)*100:4.1f}% средняя {e.mean()*100:4.1f}% 90% в {np.percentile(e,90)*100:4.1f}% ≤10% {np.mean(e<=.1)*100:3.0f}% ≤20% {np.mean(e<=.2)*100:3.0f}%"
          f" | до 10 км: медиана {np.median(es)*100:4.1f}% | КМ медиана {np.median(km)*100:4.1f}% 90% в {np.percentile(km,90)*100:4.1f}%")
    return f, b


keys0 = None
for ver in sys.argv[1:]:
    feat = {tuple(k.split("|")): v for k, v in json.load(open(f"feat_{ver}.json")).items()}
    keys = sorted(k for k in gis if k in feat and "err" not in feat[k])
    if ver == "v1":
        R = 6371
        import math
        def hav(k):
            a, b = pts[k[0]], pts[k[1]]
            la1, lo1, la2, lo2 = map(math.radians, [a["lat"], a["lon"], b["lat"], b["lon"]])
            return 2 * R * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))
        # Как на сайте сейчас: км OSRM ÷ 25 км/ч (без подбора f, β — ровно формула сайта).
        te_pts = set(random.Random(7).sample(sorted({p for k in keys for p in k}), len({p for k in keys for p in k}) // 5))
        te = [k for k in keys if k[0] in te_pts or k[1] in te_pts]
        e = np.array([abs(feat[k]["m"] / 1000 / 25 * 3600 - gis[k]["s"]) / gis[k]["s"] for k in te])
        print(f"{'сайт сейчас (км OSRM ÷ 25 км/ч)':34s} МИН медиана {np.median(e)*100:4.1f}% средняя {e.mean()*100:4.1f}% 90% в {np.percentile(e,90)*100:4.1f}% ≤10% {np.mean(e<=.1)*100:3.0f}% ≤20% {np.mean(e<=.2)*100:3.0f}%")
    f, b = report(f"{ver} (f·OSRM+β)", lambda k: feat[k]["s"], lambda k: feat[k]["m"], keys)
    if ver != "v1":
        port = "5002"
        json.dump({"f": f, "beta": b}, open(f"final_points_{ver}.json", "w"))
