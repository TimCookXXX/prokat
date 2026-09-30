#!/usr/bin/env python3
"""Вырезка OSM агломерации → pickle для build.py (≈1 мин).

  python osm_extract.py <krasnodar.osm.pbf> <out.pkl>

Берёт: адреса (узлы, контуры зданий, мультиполигоны), здания без адреса (для «посадки» адресных точек и
домов ГАР), именованные улицы (highway), места (place, admin_level 6/8/9), СНТ (place/landuse=allotments),
ЖК и объекты (ТЦ, рынки, вузы, больницы, вокзалы…). Точка контура — центроид, а если он вне контура —
point-on-surface (гарантированно внутри).
"""
import math
import os
import pickle
import sys

import osmium
import shapely.wkb as wkblib

# Вырезка геокодера шире карты OSRM (38.60..39.45 × 44.85..45.30): районы ГАР-корней целиком — Северский
# до Крепостной и Убинской, Пластуновская, Новотитаровская, Тхамаха. Что из неё войдёт в индекс, решает build.py (область —
# районы ГАР-корней + bbox агломерации). Переопределить: GEOCODER_BBOX="w,s,e,n".
BBOX = tuple(float(x) for x in os.environ.get("GEOCODER_BBOX", "38.40,44.60,39.70,45.45").split(","))
wkbfab = osmium.geom.WKBFactory()

POI_TAGS = {
    ("shop", "mall"): "mall", ("shop", "department_store"): "mall",
    ("amenity", "marketplace"): "market",
    ("amenity", "university"): "university", ("amenity", "college"): "college",
    ("amenity", "hospital"): "hospital",
    ("railway", "station"): "station", ("public_transport", "station"): "station",
    ("amenity", "bus_station"): "bus_station",
    ("aeroway", "aerodrome"): "airport", ("aeroway", "terminal"): "airport",
    ("leisure", "stadium"): "stadium", ("leisure", "park"): "park",
}
ALT_KEYS = ("alt_name", "old_name", "official_name", "short_name", "loc_name", "name:ru")
ADDR_KEYS = ("addr:housenumber", "addr:street", "addr:place", "addr:city", "addr:postcode", "addr:suburb",
             "addr2:housenumber", "addr2:street")


def in_bbox(lon, lat):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def area_m2(geom, lat):
    kx = 111320 * math.cos(math.radians(lat))
    return geom.area * kx * 110540


def inner_point(geom):
    c = geom.centroid
    if not geom.contains(c):
        c = geom.representative_point()
    return c.x, c.y


def poi_kind(t):
    for (k, v), kind in POI_TAGS.items():
        if t.get(k) == v:
            return kind
    name = t.get("name", "")
    if t.get("building") in ("retail", "commercial") and name[:3].upper() in ("ТЦ ", "ТРЦ", "ТРК", "ТК "):
        return "mall"
    return None


def alt_names(t):
    return [t.get(k) for k in ALT_KEYS if t.get(k) and t.get(k) != t.get("name")]


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.addr, self.bare, self.streets, self.places = [], [], [], []
        self.admin, self.allot, self.resid, self.pois = [], [], [], []
        self.maxts = None

    def _ts(self, o):
        if self.maxts is None or o.timestamp > self.maxts:
            self.maxts = o.timestamp

    def node(self, n):
        t = n.tags
        if not n.location.valid() or not in_bbox(n.location.lon, n.location.lat):
            return
        self._ts(n)
        lon, lat = n.location.lon, n.location.lat
        if "addr:housenumber" in t:
            d = {k: t.get(k) for k in ADDR_KEYS if k in t}
            d.update(osm=f"n{n.id}", lon=lon, lat=lat, kind="node", area=0.0, name=t.get("name"),
                     entrance="entrance" in t, poi=poi_kind(t) is not None or any(
                         k in t for k in ("shop", "amenity", "office", "craft")))
            self.addr.append(d)
        if "place" in t and t.get("name"):
            self.places.append(dict(osm=f"n{n.id}", place=t.get("place"), name=t.get("name"), lon=lon, lat=lat,
                                    wkb=None, alts=alt_names(t), population=t.get("population")))
        k = poi_kind(t)
        if k and t.get("name"):
            self.pois.append(dict(osm=f"n{n.id}", kind=k, name=t.get("name"), alts=alt_names(t), lon=lon, lat=lat,
                                  area=0.0, street=t.get("addr:street"), hn=t.get("addr:housenumber")))

    def way(self, w):
        t = w.tags
        if "highway" in t and "name" in t and t.get("highway") not in ("bus_stop", "platform", "elevator"):
            try:
                pts = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
            except osmium.InvalidLocationError:
                pts = []
            if len(pts) >= 2 and any(in_bbox(*p) for p in pts):
                self._ts(w)
                self.streets.append(dict(osm=f"w{w.id}", name=t.get("name"), highway=t.get("highway"),
                                         alts=alt_names(t), pts=pts))
        if "addr:housenumber" in t and not w.is_closed():
            try:
                pts = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
            except osmium.InvalidLocationError:
                pts = []
            if pts and in_bbox(*pts[len(pts) // 2]):
                d = {k: t.get(k) for k in ADDR_KEYS if k in t}
                lon, lat = pts[len(pts) // 2]
                d.update(osm=f"w{w.id}", lon=lon, lat=lat, kind="line", area=0.0, name=t.get("name"),
                         entrance=False, poi=False)
                self.addr.append(d)

    def area(self, a):
        t = a.tags
        is_b = "building" in t or "building:part" in t and "addr:housenumber" in t
        has_addr = "addr:housenumber" in t
        place = t.get("place")
        admin = t.get("boundary") == "administrative" and t.get("admin_level") in ("6", "8", "9")
        allot = t.get("landuse") == "allotments" or place == "allotments"
        resid = t.get("landuse") == "residential" and t.get("name")
        pk = poi_kind(t)
        if not (is_b or has_addr or place or admin or allot or resid or pk):
            return
        oid = f"{'w' if a.from_way() else 'r'}{a.orig_id()}"
        try:
            g = wkblib.loads(wkbfab.create_multipolygon(a), hex=True)
        except Exception:
            return
        if g.is_empty:
            return
        if not g.is_valid:
            g = g.buffer(0)
            if g.is_empty:
                return
        lon, lat = inner_point(g)
        if not in_bbox(lon, lat) and not (admin or place):
            return
        self._ts(a)
        m2 = area_m2(g, lat)
        if has_addr:
            d = {k: t.get(k) for k in ADDR_KEYS if k in t}
            d.update(osm=oid, lon=lon, lat=lat, kind="area", area=m2, name=t.get("name"), entrance=False,
                     poi=pk is not None or any(k in t for k in ("shop", "amenity", "office", "craft")),
                     building=t.get("building"))
            self.addr.append(d)
        elif is_b:
            self.bare.append(dict(osm=oid, lon=lon, lat=lat, area=m2, building=t.get("building"),
                                  wkb=g.wkb if m2 >= 25 else None))
        if place and t.get("name") and not is_b:
            self.places.append(dict(osm=oid, place=place, name=t.get("name"), lon=lon, lat=lat, wkb=g.wkb,
                                    alts=alt_names(t), population=t.get("population")))
        if admin and t.get("name"):
            self.admin.append(dict(osm=oid, level=t.get("admin_level"), name=t.get("name"), lon=lon, lat=lat,
                                   wkb=g.wkb))
        if allot and not is_b and place != "allotments":
            self.allot.append(dict(osm=oid, name=t.get("name"), lon=lon, lat=lat, wkb=g.wkb, area=m2,
                                   alts=alt_names(t)))
        if resid and not is_b:
            self.resid.append(dict(osm=oid, name=t.get("name"), lon=lon, lat=lat, wkb=g.wkb, area=m2,
                                   alts=alt_names(t)))
        if pk and t.get("name"):
            self.pois.append(dict(osm=oid, kind=pk, name=t.get("name"), alts=alt_names(t), lon=lon, lat=lat,
                                  area=m2, street=t.get("addr:street"), hn=t.get("addr:housenumber")))


def main():
    src, out = sys.argv[1], sys.argv[2]
    h = H()
    h.apply_file(src, locations=True, idx="flex_mem")
    res = {k: v for k, v in h.__dict__.items() if isinstance(v, list)}
    res["maxts"] = h.maxts.strftime("%Y-%m-%d") if h.maxts else None
    print({k: len(v) for k, v in res.items() if isinstance(v, list)}, res["maxts"])
    with open(out, "wb") as f:
        pickle.dump(res, f, protocol=4)


if __name__ == "__main__":
    main()
