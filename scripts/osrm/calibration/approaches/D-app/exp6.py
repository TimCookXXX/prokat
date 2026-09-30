import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exp3
from exp3 import *

_orig = exp3.design3


def design6(rs, spec):
    X, names = _orig(rs, spec)
    cols, nn = [X], list(names)
    def add(n, v): cols.append(np.asarray(v, float).reshape(-1, 1)); nn.append(n)
    km = np.array([r["km"] for r in rs]); d = np.array([r["d"] for r in rs])
    ld = np.log(np.maximum(d, 0.1))
    ra = np.array([r["ra"] for r in rs]); rb = np.array([r["rb"] for r in rs])
    sh = np.clip((np.log(8) - ld) / np.log(8), 0, 2)
    if "rrl" in spec:
        for k in (2, 4, 6, 9, 12): add(f"r>{k}*sh", (np.maximum(0, ra - k) + np.maximum(0, rb - k)) * sh)
    if "rr2" in spec:
        for k in (1, 3, 5, 7.5, 10, 14): add(f"r>{k}", np.maximum(0, ra - k) + np.maximum(0, rb - k))
    if "ymid" in spec:
        ya = np.array([pt["ya"] for pt in rs]); yb = np.array([pt["yb"] for pt in rs])
        add("north", np.maximum(0, ya) + np.maximum(0, yb)); add("south", np.maximum(0, -ya) + np.maximum(0, -yb))
    if "xmid" in spec:
        xa = np.array([pt["xa"] for pt in rs]); xb = np.array([pt["xb"] for pt in rs])
        add("east", np.maximum(0, xa) + np.maximum(0, xb)); add("west", np.maximum(0, -xa) + np.maximum(0, -xb))
    if "snapl" in spec:
        add("snap*sh", (np.minimum([r["snap_a"] for r in rs], 300) + np.minimum([r["snap_b"] for r in rs], 300)) / 100 * sh)
    return np.column_stack(cols), nn


exp3.design3 = design6


def add_xy(rows):
    pts = {p["id"]: p for p in json.load(open("points.json"))}
    from dfeat import xy
    for r in rows:
        r["xa"], r["ya"] = xy(pts[r["key"][0]]["lat"], pts[r["key"][0]]["lon"])
        r["xb"], r["yb"] = xy(pts[r["key"][1]]["lat"], pts[r["key"][1]]["lon"])


add_xy(tr)

if __name__ == "__main__":
    for spec in [("rr",), ("rr2",), ("rr", "rrl"), ("rr", "zone"), ("rr", "lkh"), ("rr", "lkh", "cross", "rmin"), ("rr", "snapl"), ("rr", "snap"),
                 ("rr", "ymid"), ("rr", "xmid"), ("rr", "ymid", "xmid"), ("rr", "zone", "zonel", "lkh", "cross", "rmin", "snap"),
                 ("rr", "rrl", "lkh", "cross")]:
        for lam in (0.003, 0.01, 0.03):
            a = cv3(spec, lam, "pt"); b = cv3(spec, lam, "cl")
            print(f"{'+'.join(spec):42s} {lam:<6} pt " + " ".join(f"{v*100:.1f}" for v in a.values()) + " | cl " + " ".join(f"{v*100:.1f}" for v in b.values()), flush=True)
