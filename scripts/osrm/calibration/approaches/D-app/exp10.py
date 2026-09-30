import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exp3
from exp7 import *
_d7 = exp3.design3


def design10(rs, spec):
    X, names = _d7(rs, spec)
    cols, nn = [X], list(names)
    def add(n, v): cols.append(np.asarray(v, float).reshape(-1, 1)); nn.append(n)
    xa = np.array([r["xa"] for r in rs]); xb = np.array([r["xb"] for r in rs]); ya = np.array([r["ya"] for r in rs]); yb = np.array([r["yb"] for r in rs])
    if "xyk" in spec:
        for k in (-6, -3, 3, 6): add(f"x>{k}", np.maximum(0, xa - k) + np.maximum(0, xb - k))
        for k in (-3, 3, 6, 10): add(f"y>{k}", np.maximum(0, ya - k) + np.maximum(0, yb - k))
    if "dir" in spec:  # поездка к центру/от центра и вдоль/поперёк
        ra = np.array([r["ra"] for r in rs]); rb = np.array([r["rb"] for r in rs])
        add("out", np.clip(rb - ra, -10, 10) / 10)
    if "same" in spec: add("same", [r["same_okrug"] for r in rs])
    return np.column_stack(cols), nn


exp3.design3 = design10
if __name__ == "__main__":
    base = ("rr", "lkh", "cross", "rmin", "ymid", "xmid")
    for spec in [base, base + ("xyk",), base + ("dir",), base + ("same",), ("rr", "lkh", "cross", "rmin", "xyk")]:
        for lam in (0.003, 0.01):
            a = cv3(spec, lam, "pt"); b = cv3(spec, lam, "cl")
            print(f"{'+'.join(spec):48s} {lam:<6} pt " + " ".join(f"{v*100:.1f}" for v in a.values()) + " | cl " + " ".join(f"{v*100:.1f}" for v in b.values()), flush=True)
