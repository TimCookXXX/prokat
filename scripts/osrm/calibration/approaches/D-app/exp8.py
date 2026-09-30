import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exp7 import *
import exp5
from exp5 import mk

if __name__ == "__main__":
    spec = ("rr", "lkh", "cross", "rmin", "ymid", "xmid")
    for groups, kw in [(("core",), dict(n_trees=50, depth=2)), (("core",), dict(n_trees=100, depth=2)), (("core",), dict(n_trees=100, depth=2, lr=0.03, min_leaf=60)),
                       (("core",), dict(n_trees=60, depth=3, min_leaf=60)), (("core", "okr"), dict(n_trees=100, depth=2))]:
        fi, pr = mk(spec, 0.003, groups, **kw)
        a = cv(None, 0, "pt", fitter=fi, predictor=pr); b = cv(None, 0, "cl", fitter=fi, predictor=pr)
        print(f"{groups} {kw} pt " + " ".join(f"{v*100:.1f}" for v in a.values()) + " | cl " + " ".join(f"{v*100:.1f}" for v in b.values()), flush=True)
