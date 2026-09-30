"""params.lua подхода C из словаря (json): скорости, штрафы, road_factors, pref (вес выбора пути),
block_ways / slow_ways (OSM way id)."""
import json


def val(v, ind=2):
    pad = " " * ind
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return f"{v:.4f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "{ " + ", ".join(val(x, ind + 2) for x in v) + " }"
    if isinstance(v, dict):
        items = []
        for k, x in v.items():
            key = f"[{k}]" if isinstance(k, int) or (isinstance(k, str) and k.isdigit()) else (k if k.isidentifier() else f"[{json.dumps(k, ensure_ascii=False)}]")
            items.append(f"{pad}  {key} = {val(x, ind + 2)},")
        return "{\n" + "\n".join(items) + f"\n{pad}}}"
    raise TypeError(v)


def lua(p, header="-- Параметры профиля car.lua (подход C: калибровка + выбор пути как у навигатора)."):
    q = dict(p)
    q.setdefault("speeds", {"fast": 90, "primary": 65, "secondary": 55, "tertiary": 40, "minor": 25, "service": 15})
    q.setdefault("use_maxspeed", False)
    q.setdefault("snap_to_service", False)
    for key in ("block_ways",):
        if key in q:
            q[key] = {str(int(w)): True for w in q[key]}
    if "slow_ways" in q:
        q["slow_ways"] = {str(int(w)): float(k) for w, k in q["slow_ways"].items()}
    q.pop("beta", None); q.pop("f", None); q.pop("notes", None)
    return header + "\nreturn " + val(q, 0) + "\n"
