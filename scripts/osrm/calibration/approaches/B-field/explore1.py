import sys, time
sys.path.insert(0, __file__.rsplit('/',1)[0])
from bf import *
from fit import Design, fit, cv
day, split = data()
ver = sys.argv[1]; step = float(sys.argv[2])
seg = load_seg(ver); import json
p_cur = json.load(open(f"approaches/B-field/params_{ver}.json")) if os.path.exists(f"approaches/B-field/params_{ver}.json") else {}
tr = sorted(k for k in day if pair_part(k, split) == "train" and k in seg and "err" not in seg[k])
G = grid(step)
D = Design(seg, day, tr, p_cur, G)
folds = point_folds(split)
t=time.time()
print("no field", cv(D, tr, folds, 1, 1, fix_field=True), time.time()-t, flush=True)
for ls in [float(a) for a in sys.argv[3].split(",")]:
    for lr in [float(a) for a in sys.argv[4].split(",")]:
        t=time.time(); print(step, ls, lr, cv(D, tr, folds, ls, lr), round(time.time()-t,1), flush=True)
