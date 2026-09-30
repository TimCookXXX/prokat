"""Подбор профиля и формулы приложения по признакам маршрутов (подход A-zones).

python fit.py <версия признаков> <params.json текущей версии> <выход params.json> [--roads N] [--lam L] [--lamr L]
Время пары (2ГИС, с) ≈ Σ метры участка × темп(класс, зона, съезд, покрытие) × (1 + ρ улицы)
  + штрафы (светофор, перекрёсток, левый/правый поворот, разворот) · их число   ← профиль OSRM
  + β(км OSRM)                                                                 ← формула приложения
Потеря — средняя |относительная ошибка| с равным весом диапазонов длины (как min_balanced),
IRLS; темп класса в зоне тянется к темпу класса (ридж λ), поправки улиц ρ — к нулю (λr).
λ — перекрёстной проверкой по группам точек внутри train.
"""
import json, sys
import numpy as np
from scipy.optimize import lsq_linear
from common import load, load_feat, point_groups, balanced, bucket_weights, OUT

CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
PEN = ["sig_hi", "sig_lo", "inter_hi", "inter_lo", "left_hi", "left_lo", "right", "uturn"]
PEN_HI = {"sig_hi": 60, "sig_lo": 60, "inter_hi": 40, "inter_lo": 30, "left_hi": 80, "left_lo": 60, "right": 60, "uturn": 150}


def decode(code):
    code = int(code)
    bad, r = divmod(code, 200)
    link, r = divmod(r, 100)
    z, c = divmod(r, 10)
    return bad, link, z, c  # z — номер зоны с 1, c — номер класса с 1


ROAD_FEAT = "road_code_m"  # поправка улицы действует на всём её протяжении, как в профиле
LAM_MIC = 0.01
APP = []  # признаки формулы приложения: crow, exc_m:<r>, exc_s:<r>


def app_value(name, f):
    om, crow = f["m"], max(f["crow"], 50.0)
    if name == "crow":
        return crow
    if name.startswith("mic:"):  # сколько концов пары в этом микрорайоне
        return float(sum(m == name[4:] for m in f["ep_mic"]))
    if name == "snap":  # сумма расстояний привязки концов к дороге, м (есть в ответе /table)
        return float(sum(f["snap"]))
    if name.startswith("exs:"):  # exc_s только для коротких: × max(0, c − км)/c
        _, r, c = name.split(":")
        r, c = float(r), float(c)
        return f["s"] * max(0.0, 1 - r * crow / max(om, 1.0)) * max(0.0, c - om / 1000) / c
    kind, r = name.split(":")
    r = float(r)
    if kind == "exc_m":
        return max(0.0, om - r * crow)
    if kind == "exc_s":
        return f["s"] * max(0.0, 1 - r * crow / max(om, 1.0))
    if kind == "ep":  # сколько концов пары ближе r км к центру
        return float(sum(d <= r for d in f["ep_d"]))
    if kind == "sh_s":  # доля времени коротких поездок: сек × max(0, r − км)/r
        return f["s"] * max(0.0, r - om / 1000) / r
    raise KeyError(name)


class Model:
    def __init__(self, nz, roads, hinges, app=None):
        self.nz, self.roads, self.hinges = nz, roads, hinges
        self.app = list(APP if app is None else app)
        self.names = [f"pace:{c}:z{z}" for c in CLASSES for z in range(1, nz + 1)] + [f"cls:{c}" for c in CLASSES]
        self.names += ["link_pace", "bad_pace"] + [f"pen:{p}" for p in PEN] + ["beta0"] + [f"hinge:{h}" for h in hinges]
        self.names += [f"app:{a}" for a in self.app]
        self.names += [f"road:{r}" for r in roads]
        self.idx = {n: i for i, n in enumerate(self.names)}

    def row(self, f, pace=None):
        x = np.zeros(len(self.names))
        for code, m in f["code_m"].items():
            bad, link, z, c = decode(code)
            if c < 1 or c > 6:
                continue
            x[self.idx[f"pace:{CLASSES[c - 1]}:z{min(z, self.nz)}"]] += m
            x[self.idx["link_pace"]] += m * link
            x[self.idx["bad_pace"]] += m * bad
        for p in PEN:
            x[self.idx[f"pen:{p}"]] = max(f.get(p, 0), 0)
        km = f["m"] / 1000
        x[self.idx["beta0"]] = 1
        for h in self.hinges:
            x[self.idx[f"hinge:{h}"]] = max(0.0, h - km)
        for a in self.app:
            x[self.idx[f"app:{a}"]] = app_value(a, f)
        return x

    def road_cols(self, f, theta):
        """Секунды на сквозных улицах при текущих темпах (для ρ)."""
        out = np.zeros(len(self.roads))
        for j, r in enumerate(self.roads):
            cm = f.get(ROAD_FEAT, {}).get(r)
            if not cm:
                continue
            s = 0.0
            for code, m in cm.items():
                bad, link, z, c = decode(code)
                if 1 <= c <= 6:
                    s += m * (theta[self.idx[f"pace:{CLASSES[c - 1]}:z{min(z, self.nz)}"]]
                              + link * theta[self.idx["link_pace"]] + bad * theta[self.idx["bad_pace"]])
            out[j] = s
        return out

    def bounds(self):
        lo, hi = [], []
        for n in self.names:
            if n.startswith("pace:") or n.startswith("cls:"):
                lo.append(3.6 / 110), hi.append(3.6 / 5)
            elif n in ("link_pace", "bad_pace"):
                lo.append(0), hi.append(0.4)
            elif n.startswith("pen:"):
                lo.append(0), hi.append(PEN_HI[n[4:]])
            elif n == "beta0":
                lo.append(-300), hi.append(900)
            elif n.startswith("hinge:"):
                lo.append(-200), hi.append(400)
            elif n.startswith("app:crow") or n.startswith("app:exc_m") or n == "app:snap":
                lo.append(-0.5), hi.append(0.5)
            elif n.startswith("app:ep") or n.startswith("app:mic:"):
                lo.append(-200), hi.append(300)
            elif n.startswith("app:exc_s") or n.startswith("app:sh_s") or n.startswith("app:exs"):
                lo.append(-1.5), hi.append(1.5)
            elif n.startswith("road:"):
                lo.append(-0.6), hi.append(1.5)  # в «долях темпа улицы»: скорость ×1/(1+ρ)
        return np.array(lo), np.array(hi)


def solve(model, X0, feats, t, bw, lam, lamr, iters=25, theta0=None):
    """IRLS для средней |отн. ошибки|; ρ улиц — через колонки секунд при темпах прошлой итерации."""
    n, P = len(t), len(model.names)
    nr = len(model.roads)
    lo, hi = model.bounds()
    # ридж: темп класса в зоне ↔ темп класса (0.1 с/м — единица), ρ улиц ↔ 0
    R = []
    for c in CLASSES:
        for z in range(1, model.nz + 1):
            r = np.zeros(P); r[model.idx[f"pace:{c}:z{z}"]] = 1; r[model.idx[f"cls:{c}"]] = -1
            R.append(r * np.sqrt(lam * n) / 0.1)
    for j in range(nr):
        r = np.zeros(P); r[P - nr + j] = 1
        R.append(r * np.sqrt(lamr * n) / 0.3)
    for name, i in model.idx.items():
        if name.startswith("app:mic:"):  # поправка микрорайона, с — к нулю
            r = np.zeros(P); r[i] = 1
            R.append(r * np.sqrt(LAM_MIC * n) / 60)
    R = np.array(R)
    theta = theta0
    w = bw / t
    X = X0.copy()
    for it in range(iters):
        if nr and theta is not None:
            X[:, P - nr:] = np.array([model.road_cols(f, theta) for f in feats])
        A = np.vstack([X * w[:, None], R])
        b = np.concatenate([t * w, np.zeros(len(R))])
        theta = lsq_linear(A, b, bounds=(lo, hi), lsmr_tol="auto", max_iter=2000).x
        rel = np.abs(X @ theta - t) / t
        w = np.sqrt(bw / np.maximum(rel, 0.02)) / t  # L1 через IRLS: вес ~ 1/|r|
    return theta, X


def run(ver, keys, ref, F, nz, roads, hinges, lam, lamr, theta0=None):
    model = Model(nz, roads, hinges)
    feats = [F[k] for k in keys]
    X0 = np.array([model.row(f) for f in feats])
    t = np.array([ref[k]["s"] for k in keys], float)
    bw = bucket_weights([ref[k]["m"] for k in keys])
    if roads and theta0 is None:
        th, _ = solve(Model(nz, [], hinges), np.array([Model(nz, [], hinges).row(f) for f in feats]), feats, t, bw, lam, 0)
        theta0 = np.concatenate([th, np.zeros(len(roads))])
    theta, X = solve(model, X0, feats, t, bw, lam, lamr, theta0=theta0)
    return model, theta


def predict(model, theta, keys, F):
    out = []
    for k in keys:
        x = model.row(F[k])
        if model.roads:
            x[len(model.names) - len(model.roads):] = model.road_cols(F[k], theta)
        out.append(x @ theta)
    return np.array(out)


def select_roads(keys, F, min_routes):
    from collections import Counter
    cnt = Counter(r for k in keys for r in F[k].get("mid_code_m", {}) if sum(F[k]["mid_code_m"][r].values()) > 200)
    return sorted(r for r, c in cnt.items() if c >= min_routes)


def cv(ref, F, keys, nz, hinges, lam, lamr, min_routes):
    folds = point_groups(keys)
    preds, trues, ms = [], [], []
    for tr, te in folds:
        roads = select_roads(tr, F, min_routes) if min_routes else []
        model, theta = run(None, tr, ref, F, nz, roads, hinges, lam, lamr)
        preds.append(predict(model, theta, te, F))
        trues.append([ref[k]["s"] for k in te]); ms.append([ref[k]["m"] for k in te])
    p, t, m = map(np.concatenate, (preds, trues, ms))
    return balanced(p, t, m)


def to_params(model, theta, prev):
    p = json.loads(json.dumps(prev))
    zn = [f"z{z}" for z in range(1, model.nz + 1)]
    p["pace"] = {c: {z: float(theta[model.idx[f"pace:{c}:{z}"]]) for z in zn} for c in CLASSES}
    p["link_pace"] = float(theta[model.idx["link_pace"]])
    p["bad_surface_pace"] = float(theta[model.idx["bad_pace"]])
    p["pen"] = {q: float(theta[model.idx[f"pen:{q}"]]) for q in PEN}
    rf = {}  # ρ подбирается от темпа без поправок — множители не накапливаются
    for r in model.roads:
        rho = theta[model.idx[f"road:{r}"]]
        rf[r] = 1 / (1 + rho)
    p["road_factors"] = {r: float(min(max(k, 0.4), 2.5)) for r, k in rf.items()}
    p["app"] = {"f": 1.0, "beta0": float(theta[model.idx["beta0"]]),
                "hinges": {str(h): float(theta[model.idx[f"hinge:{h}"]]) for h in model.hinges},
                "terms": {a: float(theta[model.idx[f"app:{a}"]]) for a in model.app}}
    return p


if __name__ == "__main__":
    ver, prev_f, out_f = sys.argv[1], sys.argv[2], sys.argv[3]
    arg = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
    prev = json.load(open(prev_f))
    ref, split, parts = load()
    F = load_feat(ver)
    keys = sorted(k for k in ref if parts[k] == "train" and k in F)
    nz = len(prev["rings"]) + 1
    hinges = [float(h) for h in arg("--hinges", "2,5,10").split(",") if h]
    APP[:] = [a for a in arg("--app", ",".join(prev.get("app", {}).get("terms", {}))).split(",") if a]
    min_routes = arg("--roads", 0)
    lams = [float(x) for x in arg("--lam", "0.001,0.01,0.1").split(",")]
    lamrs = [float(x) for x in arg("--lamr", "0.01,0.1,1").split(",")] if min_routes else [0.0]
    best = None
    for lam in lams:
        for lamr in lamrs:
            b, bs = cv(ref, F, keys, nz, hinges, lam, lamr, min_routes)
            print(f"  λ={lam:<6g} λr={lamr:<6g} CV сбаланс. {b*100:.2f}%  по диапазонам " + " ".join(f"{x*100:.1f}" for x in bs), flush=True)
            if best is None or b < best[0]:
                best = (b, lam, lamr)
    _, lam, lamr = best
    roads = select_roads(keys, F, min_routes) if min_routes else []
    model, theta = run(ver, keys, ref, F, nz, roads, hinges, lam, lamr)
    p = to_params(model, theta, {**prev, "road_factors": prev.get("road_factors", {}) if min_routes else prev.get("road_factors", {})})
    p["fit"] = {"ver": ver, "cv_balanced": best[0], "lam": lam, "lamr": lamr, "roads": len(roads)}
    json.dump(p, open(out_f, "w"), ensure_ascii=False, indent=1)
    pr = predict(model, theta, keys, F)
    b, bs = balanced(pr, np.array([ref[k]["s"] for k in keys], float), np.array([ref[k]["m"] for k in keys], float))
    print(f"{ver}: λ={lam} λr={lamr} дорог {len(roads)}; train {b*100:.2f}% ({' '.join(f'{x*100:.1f}' for x in bs)}); CV {best[0]*100:.2f}%")
    for c in CLASSES:
        print(f"  {c:9s} " + " ".join(f"{3.6/p['pace'][c][z]:5.1f}" for z in sorted(p['pace'][c])) + " км/ч")
    print("  link +%.3f с/м, покрытие +%.3f с/м; штрафы: " % (p["link_pace"], p["bad_surface_pace"]) +
          ", ".join(f"{q} {p['pen'][q]:.1f}" for q in PEN) + f"; β0 {p['app']['beta0']:.0f} hinges {p['app']['hinges']}")
