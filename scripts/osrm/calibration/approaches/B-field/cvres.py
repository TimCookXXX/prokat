import sys, json
sys.path.insert(0, __file__.rsplit('/',1)[0])
from bf import *
from fit import Design, fit
day, split = data()
ver = sys.argv[1]; ls, lr = float(sys.argv[2]), float(sys.argv[3])
seg = load_seg(ver); p = json.load(open(f'approaches/B-field/params_{ver}.json'))
tr = sorted(k for k in day if pair_part(k, split) == "train")
D = Design(seg, day, tr, p, grid(3.0)); idx={k:i for i,k in enumerate(tr)}
pred = np.zeros(len(tr))
for f in point_folds(split):
    a=[idx[k] for k in tr if k[0] not in f and k[1] not in f]; b=[idx[k] for k in tr if k[0] in f or k[1] in f]
    x=fit(D,a,ls,lr); pred[b]=D.predict(x,np.array(b))
y=D.y; km=D.km; r=pred/y; e=abs(r-1)
print('CV bal', balanced(pred,y,km)[0])
pts={q['id']:q for q in json.load(open('points.json'))}
def rep(name, vals, bins):
    for lo,hi in zip(bins[:-1],bins[1:]):
        m=(vals>=lo)&(vals<hi)
        if m.sum(): print(f'  {name} [{lo},{hi}) n={m.sum()} err {e[m].mean()*100:.1f}% ratio med {np.median(r[m]):.3f}')
sn=np.array([max(seg[k]['snap']) for k in tr]); rep('snap max', sn, [0,20,50,100,200,1e9])
S=lambda k,c: sum(s[2] for s in seg[k]['seg'] if s[4]==c)/max(seg[k]['m'],1)
rep('share service', np.array([S(k,5) for k in tr]), [0,.02,.05,.1,.2,1.01])
rep('share minor', np.array([S(k,4) for k in tr]), [0,.1,.2,.4,1.01])
rep('share fast', np.array([S(k,0) for k in tr]), [0,.01,.2,.5,1.01])
inter_per_km=np.array([seg[k]['inter']/max(seg[k]['m']/1000,.3) for k in tr]); rep('inter/km', inter_per_km, [0,3,6,10,20,99])
kmr=np.array([seg[k]['m']/day[k]['m'] for k in tr]); rep('km ratio', kmr, [0,.8,.9,1.1,1.25,9])
CEN=(45.0355,38.9753)
def dist(q): return np.hypot((q['lon']-CEN[1])*KM_LON,(q['lat']-CEN[0])*KM_LAT)
dmax=np.array([max(dist(pts[k[0]]),dist(pts[k[1]])) for k in tr]); dmin=np.array([min(dist(pts[k[0]]),dist(pts[k[1]])) for k in tr])
rep('max dist from center', dmax, [0,3,8,15,99]); rep('min dist', dmin, [0,3,8,15,99])
south=np.array([(pts[k[0]]['lat']<45.02) != (pts[k[1]]['lat']<45.02) for k in tr]).astype(float); rep('crosses lat 45.02', south, [0,.5,2])
from collections import defaultdict
kk=defaultdict(list)
for i,k in enumerate(tr):
    kk[pts[k[0]]['kind']+'>'].append(e[i]); kk['>'+pts[k[1]]['kind']].append(e[i])
print({k:(len(v),round(np.mean(v)*100,1)) for k,v in sorted(kk.items())})
json.dump({f'{a}|{b}':float(pred[i]) for i,(a,b) in enumerate(tr)}, open(f'approaches/B-field/cvpred_{ver}.json','w'))
