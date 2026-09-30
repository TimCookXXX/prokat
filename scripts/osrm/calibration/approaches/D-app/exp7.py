import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exp3
from exp6 import *

_d6 = exp3.design3
BASE = json.load(open("approaches/D-app/table_base.json"))


def design7(rs, spec):
    X, names = _d6(rs, spec)
    cols, nn = [X], list(names)
    def add(n, v): cols.append(np.asarray(v, float).reshape(-1, 1)); nn.append(n)
    if "two" in spec:
        sb = np.array([BASE["|".join(r["key"])]["s"] for r in rs]); s = np.array([r["sec"] for r in rs])
        add("l2", np.log((sb + 23) / (s + 23)))
    if "rmin2" in spec:
        rm = np.array([r["rmin"] for r in rs]); add("rmin<1.5", rm < 1.5); add("rmin<5", rm < 5)
    return np.column_stack(cols), nn


exp3.design3 = design7

if __name__ == "__main__":
    for spec in [("rr", "lkh", "cross", "rmin"), ("rr", "lkh", "cross", "rmin", "two"), ("rr", "lkh", "cross", "rmin", "rmin2"),
                 ("rr", "lkh", "cross", "rmin", "ymid", "xmid"), ("rr", "lkh", "cross", "rmin", "ymid", "xmid", "two"),
                 ("rr", "cross", "rmin", "ymid", "xmid"), ("rr", "lkh", "cross", "rmin", "ymid", "xmid", "snap")]:
        for lam in (0.003, 0.01):
            a = cv3(spec, lam, "pt"); b = cv3(spec, lam, "cl")
            print(f"{'+'.join(spec):42s} {lam:<6} pt " + " ".join(f"{v*100:.1f}" for v in a.values()) + " | cl " + " ".join(f"{v*100:.1f}" for v in b.values()), flush=True)
