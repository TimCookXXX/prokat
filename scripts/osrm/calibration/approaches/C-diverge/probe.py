"""Точная раскладка времени маршрутов: пробные сборки с теми же весами выбора пути (маршруты те же),
но «метящими» скоростями и штрафами. Время маршрута линейно по 1/скорость и штрафам — дальше
подбор скоростей идёт без пересборок (fit_time.py).

python probe.py <params.json> <tag>  → approaches/C-diverge/probe_<tag>.pkl
по паре: segs {(way, zone): метры} для классов fast…service, other_s (секунды на участках без класса),
n_sig, n_inter, s_ang (Σ сигмоид поворота), n_u, m (метры маршрута)."""
import sys, json, copy, os, pickle, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ev

ZS = {"core": 6.0, "city": 9.0, "outer": 13.5}
CLASS = {"motorway": "fast", "motorway_link": "fast", "trunk": "fast", "trunk_link": "fast", "primary": "primary",
         "primary_link": "primary", "secondary": "secondary", "secondary_link": "secondary", "tertiary": "tertiary",
         "tertiary_link": "tertiary", "unclassified": "minor", "residential": "minor", "living_street": "service",
         "service": "service"}


def probe_params(p, sig, ip, tp, ut):
    q = copy.deepcopy(p)
    q["zone_speeds"] = {c: dict(ZS) for c in ["fast", "primary", "secondary", "tertiary", "minor", "service"]}
    q["road_factors"] = {}
    q["route_use_factors"] = False
    q["signal_penalty"], q["intersection_penalty"], q["turn_penalty"], q["u_turn_penalty"] = sig, ip, tp, ut
    q["link_factor"] = p.get("link_factor", 0.5)
    # веса выбора пути — как в исходном варианте
    q.setdefault("route_turn", {"turn_penalty": p["turn_penalty"], "signal_penalty": p["signal_penalty"],
                                "u_turn_penalty": p["u_turn_penalty"], "intersection_penalty": p["intersection_penalty"]})
    assert "route_speeds" in q, "нужны route_speeds: иначе пробные скорости меняют маршруты"
    return q


def run(p, tag):
    idx = ev.edge_index()
    ways = idx["ways"]
    out = {}
    runs = {}
    # Светофор OSRM 5.27 добавляет в вес свою длительность (traffic_light_penalty) — её не меняем,
    # иначе меняются маршруты: секунды светофоров берутся из пробы A как есть (n_sig·sig).
    sg = p["signal_penalty"]
    for name, (sig, ip, tp, ut) in {"A": (sg, 0, 0, 0), "D": (sg, 1, 0, 0), "B": (sg, 0, 100, 0), "C": (sg, 0, 0, 10)}.items():
        ev.build(probe_params(p, sig, ip, tp, ut), f"probe-{tag}-{name}")
        runs[name] = ev.routes(nodes=True)
    lf = p.get("link_factor", 0.5)
    for k in runs["A"]:
        a, b, c, dd = runs["A"][k], runs["B"][k], runs["C"][k], runs["D"][k]
        segs = collections.defaultdict(float)
        other_s = 0.0
        sum_seg = 0.0
        for w, m, s in a["ways"]:
            sum_seg += s
            if m <= 0:
                continue
            t = ways[w][0] if w in ways else {}
            hw = t.get("highway")
            cl = CLASS.get(hw)
            if not cl or s <= 0:
                other_s += s
                continue
            v = m / s * 3.6 / (lf if hw.endswith("_link") else 1)
            z = min(ZS, key=lambda zz: abs(ZS[zz] - v) / ZS[zz])
            segs[(w, z)] += m
        sig_s = a["s"] - sum_seg
        n_sig = sig_s / sg if sg else 0
        n_inter = round(dd["s"] - sum(x[2] for x in dd["ways"]) - sig_s)
        s_ang = (b["s"] - sum(x[2] for x in b["ways"]) - sig_s) / 100
        n_u = round((c["s"] - sum(x[2] for x in c["ways"]) - sig_s) / 10)
        out[k] = {"segs": dict(segs), "other_s": other_s, "n_sig": n_sig, "n_inter": n_inter, "s_ang": s_ang, "n_u": n_u,
                  "m": a["m"], "same": max(abs(a["m"] - x["m"]) for x in (b, c, dd)) < 1}
    same = sum(v["same"] for v in out.values())
    print(f"probe {tag}: пар {len(out)}, маршрут одинаков во всех пробах: {same}")
    pickle.dump(out, open(f"approaches/C-diverge/probe_{tag}.pkl", "wb"))
    return out


if __name__ == "__main__":
    run(json.load(open(sys.argv[1])), sys.argv[2])
