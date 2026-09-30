"""Индекс карты: пара соседних узлов → OSM way (id, теги), координаты узлов, теги узлов-барьеров.
python osmindex.py → approaches/C-diverge/osmindex.pkl (cwd data/calibration)"""
import pickle, osmium

PBF = "/Users/timur/Desktop/sravniprokat/data/osrm/src/krasnodar.osm.pbf"
KEYS = ["highway", "name", "access", "motor_vehicle", "motorcar", "vehicle", "service", "surface", "oneway",
        "tracktype", "smoothness", "maxspeed", "lanes", "junction", "ref", "area", "bridge", "tunnel", "layer"]


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways, self.edge, self.nodes_used, self.ntags = {}, {}, set(), {}

    def way(self, w):
        hw = w.tags.get("highway")
        if not hw:
            return
        t = {k: w.tags.get(k) for k in KEYS if w.tags.get(k) is not None}
        refs = [n.ref for n in w.nodes]
        self.ways[w.id] = (t, refs)
        for a, b in zip(refs, refs[1:]):
            self.edge[(a, b)] = w.id
            self.edge[(b, a)] = w.id
        self.nodes_used.update(refs)


h = H()
h.apply_file(PBF)


class N(osmium.SimpleHandler):
    def __init__(self, used):
        super().__init__()
        self.used, self.loc, self.tags = used, {}, {}

    def node(self, n):
        if n.id in self.used:
            self.loc[n.id] = (n.location.lat, n.location.lon)
            t = {k: n.tags.get(k) for k in ("barrier", "access", "motor_vehicle", "highway", "traffic_calming") if n.tags.get(k)}
            if t:
                self.tags[n.id] = t


n = N(h.nodes_used)
n.apply_file(PBF)
pickle.dump({"ways": h.ways, "edge": h.edge, "loc": n.loc, "ntags": n.tags}, open("approaches/C-diverge/osmindex.pkl", "wb"))
print("ways", len(h.ways), "edges", len(h.edge) // 2, "nodes", len(n.loc), "tagged nodes", len(n.tags))
