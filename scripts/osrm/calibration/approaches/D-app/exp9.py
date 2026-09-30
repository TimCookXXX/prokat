import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exp7 import *
if __name__ == "__main__":
    spec = ("rr", "lkh", "cross", "rmin", "ymid", "xmid")
    for eps in (0.005, 0.02, 0.05):
        a = cv(None, 0, "pt", fitter=lambda a: fit3(a, spec, 0.003, eps=eps)[0], predictor=lambda th, b: np.exp(exp3.design3(b, spec)[0] @ th))
        print("B0", os.environ.get("B0"), "eps", eps, " ".join(f"{v*100:.1f}" for v in a.values()), flush=True)
