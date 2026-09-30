"""params.lua для профиля car.lua из подобранных параметров."""
CLASSES = ["fast", "primary", "secondary", "tertiary", "minor", "service"]
ZONES = ["core", "city", "outer"]


def lua(p):
    zs = ",\n    ".join(f"{c} = {{ " + ", ".join(f"{z} = {p['zone_speeds'][c][z]:.2f}" for z in ZONES) + " }" for c in CLASSES)
    rf = "\n".join(f'    ["{n}"] = {k:.3f},' for n, k in sorted(p.get("road_factors", {}).items()))
    return f"""-- Параметры профиля car.lua — подобраны по эталону 2ГИС (data/calibration/loop.py).
return {{
  speeds = {{ fast = 90, primary = 65, secondary = 55, tertiary = 40, minor = 25, service = 15 }},
  zone_speeds = {{
    {zs}
  }},
  link_factor = {p['link_factor']},
  turn_penalty = {p['turn_penalty']:.2f},
  signal_penalty = {p['signal_penalty']:.2f},
  u_turn_penalty = {p['u_turn_penalty']:.2f},
  intersection_penalty = {p['intersection_penalty']:.2f},
  road_factors = {{
{rf}
  }},
  use_maxspeed = false,
  snap_to_service = false,
}}
"""
