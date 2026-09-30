"""Какие пары используют участок: python who.py <routes.pkl> <way_id>..."""
import json, pickle, sys, collections
sys.path.insert(0, "/Users/timur/Desktop/sravniprokat/scripts/osrm/calibration")
from evalkit import load_work, pair_part
routes = pickle.load(open(sys.argv[1], "rb"))
ref, split = load_work(); day = ref["day"]
pts = {p["id"]: p for p in json.load(open("points.json"))}
for w in map(int, sys.argv[2:]):
    print("==", w)
    c = collections.Counter()
    for k, r in routes.items():
        if k in day and pair_part(k, split) == "train" and any(x[0] == w for x in r["ways"]):
            g = day[k]
            c[k[0]] += 1; c[k[1]] += 1
            print(f"  {k[0]:>14s} → {k[1]:<14s} osrm {r['m']/1000:6.2f} км {r['s']/60:5.1f} мин | 2гис {g['m']/1000:6.2f} км {g['s']/60:5.1f} мин")
    print("  концы:", c.most_common(4))
