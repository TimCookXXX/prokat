"""Конфигурации подхода C: выбор пути R1 (найден opt_route.py на train)."""
import json, copy

BASE = "approaches/C-diverge/params_v0.json"
Z = lambda v: {"core": v, "city": v, "outer": v}


def r1(base=None):
    p = copy.deepcopy(base or json.load(open(BASE)))
    p["route_speeds"] = {"fast": Z(90), "primary": Z(55.25), "secondary": Z(64.9), "tertiary": Z(40), "minor": Z(25), "service": Z(15)}
    p["route_turn"] = {"turn_penalty": 16.0, "signal_penalty": 4.26, "u_turn_penalty": 42.64, "intersection_penalty": 5.61}
    p["snap"] = {"service": True, "living_street": True}
    return p
