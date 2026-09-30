"""Вариант выбора пути → пробы → подбор времени (CV по группам точек train).
python full.py <tag> <route params.json>"""
import sys, os, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import probe, ev
H = os.path.dirname(os.path.abspath(__file__))
tag, rp = sys.argv[1], sys.argv[2]
p = json.load(open(rp))
R, m = ev.run(p, f"route-{tag}")
probe.run(p, tag)
subprocess.run([sys.executable, f"{H}/make_t.py", tag, rp, f"t-{tag}"] + sys.argv[3:], check=True)
