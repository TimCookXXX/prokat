#!/usr/bin/env python3
"""Сборка адресного индекса агломерации: OSM + ГАР → geo_places / geo_streets / geo_houses / geo_pois.

  python build.py --osm work/osm.pkl [--gar work/gar] --geo-data src/lib/compare/geo-data.ts \
                  [--db $DATABASE_URL] [--city krasnodar] [--report report.md] [--dump rows.pkl]

Шаги (подробно — README.md рядом):
  1. места: пункты (полигоны place=*, узлы без полигона — ближайший), округа (admin_level 9),
     микрорайоны (geo-data.ts + OSM suburb/quarter/neighbourhood), СНТ (OSM + ГАР, одно имя — одна запись);
  2. каждая точка (дом, кусок улицы, здание) → пункт и СНТ ПРОСТРАНСТВЕННО (точка в полигоне / ближайший);
  3. улицы: (пункт, ключ имени) → кластеры по расстоянию; подпись и тип — канонические (textnorm);
  4. дома OSM: здания (точка внутри контура), адресные узлы (посадка на контур), addr:place, addr2, склейка дублей;
  5. ГАР: пункт → улица → номер; нет в OSM — интерполяция по соседям той же чётности (≤150 м) → interpolated,
     иначе точка улицы → street (для улиц без линии в малом пункте/СНТ — place);
  6. объекты: ТЦ, рынки, ЖК, вузы, больницы, вокзалы… с адресом здания;
  7. запись в Postgres одной транзакцией (DELETE по city_id + COPY) и отчёт качества.
"""
import argparse
import bisect
import collections
import csv
import datetime
import hashlib
import json
import math
import os
import pickle
import re
import sys
import time

import numpy as np
import shapely
import shapely.wkb as wkblib
from shapely import STRtree
from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import linemerge

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import textnorm as tn  # noqa: E402

try:
    from rapidfuzz import fuzz
except ImportError:  # в контейнере ставится вместе с остальным; без него — только точные совпадения
    fuzz = None

T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


# ---------------------------------------------------------------- геометрия (локальные метры)

LAT0 = 45.05
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110540.0


def to_m(lon, lat):
    return (lon - 39.0) * KX, (lat - 45.0) * KY


def to_ll(x, y):
    return x / KX + 39.0, y / KY + 45.0


def geom_m(wkb):
    g = wkblib.loads(wkb)
    return shapely.transform(g, lambda a: np.column_stack(((a[:, 0] - 39.0) * KX, (a[:, 1] - 45.0) * KY)))


def geom_ll(g):
    return shapely.transform(g, lambda a: np.column_stack((a[:, 0] / KX + 39.0, a[:, 1] / KY + 45.0)))


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def sid(prefix, key):
    return prefix + "_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:14]


def bounds_json(g_m, tol=15.0):
    """Упрощённый контур в [lon, lat] (только внешние кольца) — для обратного геокодирования."""
    if g_m is None:
        return None
    g = g_m.simplify(tol, preserve_topology=True)
    polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g] if g.geom_type == "Polygon" else []
    rings = []
    for p in polys:
        if p.area < 400:
            continue
        rings.append([[round(x / KX + 39.0, 6), round(y / KY + 45.0, 6)] for x, y in p.exterior.coords])
    return rings or None


# ---------------------------------------------------------------- модель

class Place:
    def __init__(self, pid, kind, name, x, y, poly=None, source="osm", osm=None, gar=None):
        self.id, self.kind, self.name = pid, kind, name
        self.aliases = []
        self.parent = None
        self.x, self.y = x, y
        self.poly = poly
        self.source, self.osm, self.gar = source, osm, gar
        self.key = ""
        self.settlement = None   # для СНТ/микрорайона — пункт, в котором он лежит
        self.area = poly.area if poly is not None else 0.0

    def add_alias(self, a):
        a = tn.clean(a)
        if a and a.lower() != self.name.lower() and a.lower() not in (x.lower() for x in self.aliases):
            self.aliases.append(a)


class Street:
    def __init__(self):
        self.aliases, self.lines, self.houses = [], [], []
        self.variants = collections.Counter()
        self.gar = None
        self.source = "osm"
        self.osm_house_by_norm = {}
        self.typ = ""
        self.gar_precision = "place"     # точность домов улицы только из ГАР (точка — место)


class House:
    __slots__ = ("street", "place", "number", "norm", "x", "y", "precision", "source", "postcode", "osm", "gar",
                 "area", "base")

    def __init__(self, street, place, number, norm, x, y, precision, source, postcode=None, osm=None, gar=None,
                 area=0.0):
        self.street, self.place, self.number, self.norm = street, place, number, norm
        self.x, self.y = x, y
        self.precision, self.source = precision, source
        self.postcode, self.osm, self.gar, self.area = postcode, osm, gar, area
        self.base = tn.number_base(norm)


# ---------------------------------------------------------------- geo-data.ts (микрорайоны и округа сайта)

def read_geo_data(path, city):
    """Округа и микрорайоны из src/lib/compare/geo-data.ts (строки-объекты с slug/name/lat/lon/aliases)."""
    text = open(path, encoding="utf-8").read()
    start = text.find(f'citySlug: "{city}"')
    if start < 0:
        raise SystemExit(f"в {path} нет города {city}")
    nxt = text.find("citySlug:", start + 10)
    block = text[start:nxt if nxt > 0 else len(text)]
    rows = []
    for m in re.finditer(r"\{\s*slug:\s*\"([^\"]+)\",\s*name:\s*\"([^\"]+)\",(.*?)\}", block):
        body = m.group(3)
        okrug = re.search(r"okrug:\s*\"([^\"]+)\"", body)
        lat = float(re.search(r"lat:\s*([\d.]+)", body).group(1))
        lon = float(re.search(r"lon:\s*([\d.]+)", body).group(1))
        al = re.search(r"aliases:\s*\[(.*?)\]", body)
        aliases = re.findall(r"\"([^\"]+)\"", al.group(1)) if al else []
        rows.append(dict(slug=m.group(1), name=m.group(2), okrug=okrug.group(1) if okrug else None,
                         lat=lat, lon=lon, aliases=aliases))
    okrugs = [r for r in rows if r["okrug"] is None]
    micro = [r for r in rows if r["okrug"] is not None]
    return okrugs, micro


# ---------------------------------------------------------------- 1. места

# Типы, при которых имя — точно улица (а не микрорайон «Догма Парк» / «Красная площадь»).
ROAD_TYPES = {"улица", "переулок", "проезд", "проспект", "бульвар", "шоссе", "тупик", "набережная", "проулок",
              "въезд", "спуск", "дорога", "тракт"}
SETTLE_KIND = {"city": "city", "town": "town", "village": "village", "hamlet": "hamlet"}


class Places:
    def __init__(self):
        self.all = {}
        self.settlements = []
        self.snts = []
        self.micro = []
        self.okrugs = []

    def add(self, p):
        if p.id in self.all:
            raise ValueError(f"повтор id места {p.id}: {self.all[p.id].name} / {p.name}")
        self.all[p.id] = p
        return p

    def check_parents(self):
        """Родитель существует и цепочка без циклов; иначе родитель сбрасывается."""
        bad = 0
        for p in self.all.values():
            if p.parent is not None and p.parent not in self.all:
                p.parent = None
                bad += 1
        for p in self.all.values():
            seen, q = set(), p
            while q is not None and q.id not in seen:
                seen.add(q.id)
                q = self.all.get(q.parent) if q.parent else None
            if q is not None:
                p.parent = None
                bad += 1
        return bad


def build_places(osm, okrugs_gd, micro_gd, city_name):
    P = Places()
    # Пункты: полигон place=* (узел того же имени внутри — центр), узлы без полигона — точка.
    nodes = [p for p in osm["places"] if p["place"] in SETTLE_KIND and p["wkb"] is None]
    polys = [p for p in osm["places"] if p["place"] in SETTLE_KIND and p["wkb"] is not None]
    used_nodes = set()
    for p in polys:
        g = geom_m(p["wkb"])
        x, y = to_m(p["lon"], p["lat"])
        for n in nodes:
            if n["osm"] in used_nodes or tn.place_key(n["name"]) != tn.place_key(p["name"]):
                continue
            nx, ny = to_m(n["lon"], n["lat"])
            if g.contains(Point(nx, ny)):
                x, y = nx, ny
                used_nodes.add(n["osm"])
                break
        pl = Place(sid("p", "osm:" + p["osm"]), SETTLE_KIND[p["place"]], tn.clean(p["name"]), x, y, g, osm=p["osm"])
        for a in p["alts"]:
            pl.add_alias(a)
        P.settlements.append(P.add(pl))
    for n in nodes:
        if n["osm"] in used_nodes:
            continue
        x, y = to_m(n["lon"], n["lat"])
        # узел внутри полигона пункта с тем же именем уже учтён; одноимённый рядом — пропускаем
        if any(tn.place_key(s.name) == tn.place_key(n["name"]) and dist((s.x, s.y), (x, y)) < 3000
               for s in P.settlements):
            continue
        pl = Place(sid("p", "osm:" + n["osm"]), SETTLE_KIND[n["place"]], tn.clean(n["name"]), x, y, None, osm=n["osm"])
        for a in n["alts"]:
            pl.add_alias(a)
        P.settlements.append(P.add(pl))
    for s in P.settlements:
        s.key = tn.place_key(s.name)
        # «хутор Ленина» → имя «Ленина»? Нет: в OSM имя с типом — так и подписывают; ключ без типа.
    city = max((s for s in P.settlements if s.kind == "city" and s.key == tn.place_key(city_name)),
               key=lambda s: s.area, default=None)
    if city is None:
        raise SystemExit(f"в OSM нет пункта place=city «{city_name}»")
    P.city = city

    # Округа (admin_level 9) — имена и синонимы из geo-data.ts, контуры OSM.
    adm9 = [a for a in osm["admin"] if a["level"] == "9"]
    for o in okrugs_gd:
        k = tn.place_key(o["name"]).replace("округ", "").strip()
        poly = None
        osm_ref = None
        for a in adm9:
            if k and k in tn.place_key(a["name"]):
                poly, osm_ref = geom_m(a["wkb"]), a["osm"]
        x, y = to_m(o["lon"], o["lat"])
        pl = Place(sid("p", "geo:okrug:" + o["slug"]), "okrug", o["name"], x, y, poly, osm=osm_ref)
        for a in o["aliases"]:
            pl.add_alias(a)
        pl.parent = city.id
        pl.key = tn.place_key(o["name"])
        pl.settlement = city
        P.okrugs.append(P.add(pl))
    okrug_by_slug = {o["slug"]: P.all[sid("p", "geo:okrug:" + o["slug"])] for o in okrugs_gd}

    # Микрорайоны: справочник сайта (центр, синонимы) + OSM suburb/quarter/neighbourhood (контур и прочие).
    # «улица Ивана Беличенко» с place=neighbourhood — ошибка разметки, не микрорайон
    osm_micro = [p for p in osm["places"] if p["place"] in ("suburb", "quarter", "neighbourhood")
                 and not tn.residential_complex(p["name"]) and not tn.is_snt_label(p["name"])
                 and tn.split_street(p["name"])[1] not in ROAD_TYPES]
    taken = set()
    for m in micro_gd:
        x, y = to_m(m["lon"], m["lat"])
        keys = {tn.place_key(m["name"])} | {tn.place_key(a) for a in m["aliases"]}
        poly, osm_ref = None, None
        best = None
        matches = []
        for p in osm_micro:
            if tn.place_key(p["name"]) in keys:
                px, py = to_m(p["lon"], p["lat"])
                d = dist((x, y), (px, py))
                if d < 4000:
                    matches.append((d, p))
        if matches:
            # в OSM микрорайон часто и узлом, и контуром: берутся все, контур — ближайший
            best = min(matches, key=lambda t: t[0])
            for _, p in matches:
                taken.add(p["osm"])
            p = best[1]
            osm_ref = p["osm"]
            with_poly = [t for t in matches if t[1]["wkb"]]
            if with_poly:
                poly = geom_m(min(with_poly, key=lambda t: t[0])[1]["wkb"])
        pl = Place(sid("p", "geo:micro:" + m["slug"]), "microdistrict", m["name"], x, y, poly, osm=osm_ref)
        for a in m["aliases"]:
            pl.add_alias(a)
        if best and tn.clean(best[1]["name"]).lower() != m["name"].lower():
            pl.add_alias(best[1]["name"])
        pl.parent = okrug_by_slug[m["okrug"]].id if m["okrug"] in okrug_by_slug else city.id
        pl.settlement = city
        pl.key = tn.place_key(m["name"])
        P.micro.append(P.add(pl))
    # прочие микрорайоны OSM; одноимённые рядом (узел и контур, два контура одного массива) — одно место:
    # сначала контуры (большие первыми), затем узлы; то же имя внутри контура или ближе MICRO_SAME_M — склеивается
    rest = [p for p in osm_micro if p["osm"] not in taken]
    rest.sort(key=lambda p: (p["wkb"] is None, -(geom_m(p["wkb"]).area if p["wkb"] else 0.0)))
    merged = 0
    for p in rest:
        x, y = to_m(p["lon"], p["lat"])
        poly = geom_m(p["wkb"]) if p["wkb"] else None
        name = tn.clean(p["name"])
        key = tn.place_key(name)
        same = None
        for q in P.micro:
            if q.key != key:
                continue
            near = dist((q.x, q.y), (x, y)) < MICRO_SAME_M
            inside = (q.poly is not None and q.poly.distance(Point(x, y)) < 200) or (
                poly is not None and poly.distance(Point(q.x, q.y)) < 200)
            if near or inside:
                same = q
                break
        if same is not None:
            for a in p["alts"]:
                same.add_alias(a)
            if same.poly is None and poly is not None:
                same.poly, same.area = poly, poly.area
            merged += 1
            continue
        pl = Place(sid("p", "osm:" + p["osm"]), "microdistrict", name, x, y, poly, osm=p["osm"])
        for a in p["alts"]:
            pl.add_alias(a)
        pl.key = key
        P.micro.append(P.add(pl))
    build_places.micro_merged = merged
    return P


MICRO_SAME_M = 1500.0      # одноимённые микрорайоны OSM ближе — одно место


def settlement_locator(P):
    """Функция (x, y) → пункт: самый маленький полигон, содержащий точку; вне полигонов — ближайший узел
    пункта без полигона (≤2,5 км) или ближайший полигон (≤1 км)."""
    polys = [s for s in P.settlements if s.poly is not None]
    tree = STRtree([s.poly for s in polys])
    nodes = [s for s in P.settlements if s.poly is None]
    ntree = STRtree([Point(s.x, s.y) for s in nodes]) if nodes else None

    def locate_many(xs, ys):
        pts = shapely.points(np.asarray(xs), np.asarray(ys))
        out = [None] * len(xs)
        best = [math.inf] * len(xs)
        pi, gi = tree.query(pts, predicate="within")
        for a, b in zip(pi.tolist(), gi.tolist()):
            s = polys[b]
            if s.area < best[a]:
                best[a], out[a] = s.area, s
        miss = [i for i in range(len(xs)) if out[i] is None]
        if miss:
            mp = pts[miss]
            if ntree is not None:
                ii, jj = ntree.query_nearest(mp, max_distance=2500, return_distance=False)
                for a, b in zip(ii.tolist(), jj.tolist()):
                    out[miss[a]] = nodes[b]
            miss2 = [i for i in miss if out[i] is None]
            if miss2:
                ii, jj = tree.query_nearest(pts[miss2], max_distance=1000, return_distance=False)
                for a, b in zip(ii.tolist(), jj.tolist()):
                    out[miss2[a]] = polys[b]
        return out

    return locate_many


def poly_locator(items):
    """(x, y) → самый маленький полигон из items, содержащий точку (или None)."""
    items = [p for p in items if p.poly is not None]
    if not items:
        return lambda xs, ys: [None] * len(xs)
    tree = STRtree([p.poly for p in items])

    def locate_many(xs, ys):
        pts = shapely.points(np.asarray(xs), np.asarray(ys))
        out = [None] * len(xs)
        best = [math.inf] * len(xs)
        pi, gi = tree.query(pts, predicate="within")
        for a, b in zip(pi.tolist(), gi.tolist()):
            p = items[b]
            if p.area < best[a]:
                best[a], out[a] = p.area, p
        return out

    return locate_many


def build_snts(P, osm, locate_settlement):
    """СНТ из OSM: place=allotments (полигон/узел) и landuse=allotments. Одно имя в пределах 3 км — одна запись.
    Безымянный контур получает имя по addr:city/addr:suburb домов внутри (если это имя СНТ)."""
    raw = []
    for p in osm["places"]:
        if p["place"] == "allotments" or (p["place"] in ("suburb", "quarter", "neighbourhood")
                                          and tn.is_snt_label(p["name"])):
            raw.append(dict(osm=p["osm"], name=p["name"], lon=p["lon"], lat=p["lat"], wkb=p["wkb"], alts=p["alts"]))
    settle_refs = {p.osm for p in P.settlements}
    for a in osm["allot"]:
        if a["osm"] in settle_refs:
            continue                                 # контур пункта с landuse=allotments — не СНТ
        raw.append(dict(osm=a["osm"], name=a["name"], lon=a["lon"], lat=a["lat"], wkb=a["wkb"], alts=a["alts"]))
    # имена безымянных контуров — по адресам внутри
    unnamed = [r for r in raw if not r["name"] and r["wkb"]]
    if unnamed:
        polys = [geom_m(r["wkb"]) for r in unnamed]
        tree = STRtree(polys)
        labels = [collections.Counter() for _ in unnamed]
        cand = [a for a in osm["addr"] if (a.get("addr:city") and tn.is_snt_label(a["addr:city"])) or
                (a.get("addr:suburb") and tn.is_snt_label(a["addr:suburb"]))]
        if cand:
            pts = shapely.points([to_m(a["lon"], a["lat"]) for a in cand])
            pi, gi = tree.query(pts, predicate="within")
            for a, b in zip(pi.tolist(), gi.tolist()):
                ad = cand[a]
                lab = ad.get("addr:suburb") if ad.get("addr:suburb") and tn.is_snt_label(ad["addr:suburb"]) \
                    else ad["addr:city"]
                labels[b][lab] += 1
        for r, lab in zip(unnamed, labels):
            if lab:
                name, n = lab.most_common(1)[0]
                if n >= 3:
                    r["name"] = name
    groups = []   # [(key, x, y, [raw])]
    for r in raw:
        if not r["name"]:
            continue
        k = tn.snt_key(r["name"])
        if not k:
            continue
        x, y = to_m(r["lon"], r["lat"])
        for g in groups:
            if g[0] == k and dist((g[1], g[2]), (x, y)) < 3000:
                g[3].append(r)
                break
        else:
            groups.append([k, x, y, [r]])
    for k, x, y, rs in groups:
        polys = [geom_m(r["wkb"]) for r in rs if r["wkb"]]
        poly = shapely.union_all(polys) if polys else None
        if poly is not None:
            c = poly.centroid
            if not poly.contains(c):
                c = poly.representative_point()
            x, y = c.x, c.y
        core = tn.snt_core(rs[0]["name"])
        pl = Place(sid("p", "osm-snt:" + sorted(r["osm"] for r in rs)[0]), "snt", f"СНТ {core}", x, y, poly,
                   osm=sorted(r["osm"] for r in rs)[0])
        pl.key = k
        for r in rs:
            pl.add_alias(r["name"])
            for a in r["alts"]:
                pl.add_alias(a)
        P.snts.append(P.add(pl))
    # пункт СНТ — по положению центра
    st = locate_settlement([p.x for p in P.snts], [p.y for p in P.snts])
    for p, s in zip(P.snts, st):
        p.settlement = s if s is not p else None
        p.parent = p.settlement.id if p.settlement else None
    # пункт для микрорайонов OSM (у справочных — Краснодар) и округ Краснодара как родитель
    ok_loc = poly_locator(P.okrugs)
    ms = [m for m in P.micro if m.settlement is None]
    st = locate_settlement([m.x for m in ms], [m.y for m in ms])
    ok = ok_loc([m.x for m in ms], [m.y for m in ms])
    for m, s, o in zip(ms, st, ok):
        m.settlement = s
        if s is P.city and o is not None:
            m.parent = o.id
        else:
            m.parent = s.id if s else None


def snt_from_labels(P, osm, locate_settlement):
    """СНТ по подписям домов: addr:city / addr:suburb вида «Родник СТ», «СНТ «Лесное»», «Солнышко нст».
    Одно имя (ключ snt_key) рядом (≤1,5 км) — одна группа. Группа внутри известного СНТ — его синонимы; у СНТ
    без контура (узел place=allotments) — контур по домам (выпуклая оболочка + 40 м); СНТ нет — новое место.
    Опечатки в названии пункта («Елизаветенская», ≥5 домов) — синоним пункта."""
    pts = collections.defaultdict(list)
    for a in osm["addr"]:
        lab = None
        for k in ("addr:suburb", "addr:city"):
            v = a.get(k)
            if v and tn.is_snt_label(v):
                lab = v
                break
        if lab and tn.snt_key(lab):
            pts[tn.snt_key(lab)].append((to_m(a["lon"], a["lat"]), tn.clean(lab)))
    by_key = collections.defaultdict(list)
    for p in P.snts:
        by_key[p.key].append(p)
        for al in p.aliases:
            by_key[tn.snt_key(al)].append(p)
    snt_loc = poly_locator(P.snts)
    created = attached = hulls = 0
    for key, items in pts.items():
        # кластеры по 1,5 км
        arr = shapely.points([xy for xy, _ in items])
        tree = STRtree(arr)
        par = list(range(len(items)))

        def f(i):
            while par[i] != i:
                par[i] = par[par[i]]
                i = par[i]
            return i

        ii, jj = tree.query(arr, predicate="dwithin", distance=1500)
        for i, j in zip(ii.tolist(), jj.tolist()):
            if i < j:
                a_, b_ = f(i), f(j)
                if a_ != b_:
                    par[a_] = b_
        groups = collections.defaultdict(list)
        for i in range(len(items)):
            groups[f(i)].append(items[i])
        for g in groups.values():
            if len(g) < 3:
                continue
            xs = sorted(xy[0] for xy, _ in g)
            ys = sorted(xy[1] for xy, _ in g)
            mx, my = xs[len(xs) // 2], ys[len(ys) // 2]
            labels = collections.Counter(lab for _, lab in g)
            inside = collections.Counter(p.id for p in snt_loc([xy[0] for xy, _ in g], [xy[1] for xy, _ in g]) if p)
            target = None
            for p in by_key.get(key, []):
                if inside.get(p.id, 0) >= len(g) / 2 or dist((p.x, p.y), (mx, my)) < 2000:
                    target = p
                    break
            if target is None and inside:
                pid, n = inside.most_common(1)[0]
                cand = P.all[pid]
                if n >= len(g) / 2 and fuzz is not None and fuzz.ratio(cand.key, key) >= 80:
                    target = cand
            if target is None:
                target = Place(sid("p", f"osm-label:{key}:{int(mx) // 500}:{int(my) // 500}"), "snt",
                               f"СНТ {tn.snt_core(labels.most_common(1)[0][0])}", mx, my, None)
                target.key = key
                P.add(target)
                P.snts.append(target)
                by_key[key].append(target)
                created += 1
            else:
                attached += 1
            for lab, n in labels.most_common(6):
                if n >= 2:
                    target.add_alias(lab)
            if target.poly is None:
                hull = shapely.MultiPoint([xy for xy, _ in g]).convex_hull.buffer(40)
                target.poly = hull
                target.area = hull.area
                hulls += 1
    for p in P.snts:
        if p.settlement is None and p.parent is None:
            s_ = locate_settlement([p.x], [p.y])[0]
            p.settlement = s_ if s_ is not p else None
            p.parent = p.settlement.id if p.settlement else None
    # опечатки в имени пункта
    typos = collections.Counter()
    keys = {s.key for s in P.settlements}
    cand = [a for a in osm["addr"] if a.get("addr:city") and not tn.is_snt_label(a["addr:city"])
            and tn.place_key(a["addr:city"]) not in keys]
    if cand:
        st = locate_settlement([to_m(a["lon"], a["lat"])[0] for a in cand], [to_m(a["lon"], a["lat"])[1] for a in cand])
        for a, s_ in zip(cand, st):
            if s_ is not None:
                typos[(s_.id, tn.clean(a["addr:city"]))] += 1
    typo_n = 0
    for (pid, lab), n in typos.items():
        s_ = P.all[pid]
        if n >= 5 and fuzz is not None and fuzz.ratio(tn.place_key(lab), s_.key) >= 80:
            s_.add_alias(lab)
            typo_n += 1
    return dict(snt_label_groups_attached=attached, snt_created_from_labels=created, snt_hulls=hulls,
                settlement_typo_aliases=typo_n)


# ---------------------------------------------------------------- 3–4. улицы и дома OSM

def addr_city_agreement(P, addrs):
    """Сверка пространственной привязки с addr:city (где addr:city — пункт, а не СНТ): доля совпадений.
    «Краснодар» у посёлков городского округа — не ошибка привязки, считается отдельно."""
    keys = {s.key for s in P.settlements}
    city_key = P.city.key
    total = same = krd_suburb = 0
    diff = collections.Counter()
    for d in addrs:
        c = d["a"].get("addr:city")
        if not c or tn.is_snt_label(c):
            continue
        k = tn.place_key(c)
        if k not in keys:
            continue
        total += 1
        got = d["settlement"].key if d["settlement"] is not None else None
        if got == k:
            same += 1
        elif k == city_key:
            krd_suburb += 1
        else:
            diff[(c, d["settlement"].name if d["settlement"] else "-")] += 1
    return dict(checked=total, same=same, share=round(same / max(1, total), 4),
                krasnodar_label_in_suburb=krd_suburb,
                share_excl_krasnodar_label=round(same / max(1, total - krd_suburb), 4),
                top_diff=[f"{a} → {b}: {n}" for (a, b), n in diff.most_common(8)])


def split_numbers(hn):
    """«57; 59» и «180;267» — два адреса; «2,пер. 1», «16А, оф. 407» — первый номер."""
    hn = tn.clean(hn)
    if ";" in hn:
        return [h.strip() for h in hn.split(";") if h.strip()]
    if "," in hn:
        return [hn.split(",")[0].strip()]
    return [hn]


def valid_norm(norm):
    return bool(norm) and bool(re.match(r"^\d", norm)) and len(norm) <= 30


NEAR_ANY_ZONE = 150.0     # м: ближе — одна улица, даже если по разные стороны границы СНТ
NEAR_SAME_ZONE = 400.0    # м: в одном СНТ (или вне СНТ) — одна улица, дальше — одноимённые разные


def cluster_streets(P, osm, locate_settlement, locate_snt, gar_sets=None):
    """Улицы: элементы (куски highway и дома OSM с addr:street) группируются по (пункт, ключ имени), внутри
    группы — связные компоненты: два элемента связаны, если ближе NEAR_ANY_ZONE или ближе NEAR_SAME_ZONE в одной
    «зоне» (одно СНТ / вне СНТ). Дома связываются с линиями, дома без линии рядом — между собой. Компонента с двумя
    нумерациями делится (split_by_numbering); gar_sets — номера домов одноимённых улиц ГАР пункта
    (gar_same_name_streets)."""
    segs = []
    for s in osm["streets"]:
        key = tn.street_key(s["name"])
        if not key:
            continue
        pts = [to_m(lon, lat) for lon, lat in s["pts"]]
        ls = LineString(pts)
        mid = ls.interpolate(0.5, normalized=True)
        segs.append(dict(key=key, name=s["name"], alts=s["alts"], line=ls, x=mid.x, y=mid.y, osm=s["osm"],
                         highway=s["highway"], typ=tn.effective_type(s["name"])))
    st = locate_settlement([s["x"] for s in segs], [s["y"] for s in segs])
    sn = locate_snt([s["x"] for s in segs], [s["y"] for s in segs])
    for s, a, b in zip(segs, st, sn):
        s["settlement"], s["zone"] = a, b

    addrs = []
    for a in osm["addr"]:
        nums = []
        if a.get("addr:housenumber"):
            nums.append((a.get("addr:street"), a.get("addr:place"), a["addr:housenumber"]))
        if a.get("addr2:housenumber") and a.get("addr2:street"):
            nums.append((a["addr2:street"], None, a["addr2:housenumber"]))
        x, y = to_m(a["lon"], a["lat"])
        for street, place, hn in nums:
            if not street and place and tn.split_street(place)[1] in ROAD_TYPES:
                street, place = place, None      # addr:place=«улица Ивана Беличенко» — это улица
            for h in split_numbers(hn):
                norm = tn.number_norm(h)
                if not valid_norm(norm):
                    continue
                addrs.append(dict(street=tn.clean(street) if street else None,
                                  key=tn.street_key(street) if street else "", place=place,
                                  typ=tn.effective_type(street) if street else "",
                                  number=tn.number_display(h), norm=norm, x=x, y=y, a=a))
    st = locate_settlement([d["x"] for d in addrs], [d["y"] for d in addrs])
    sn = locate_snt([d["x"] for d in addrs], [d["y"] for d in addrs])
    for d, a, b in zip(addrs, st, sn):
        d["settlement"], d["zone"] = a, b
    log("кусков улиц", len(segs), "адресов OSM", len(addrs))

    groups = collections.defaultdict(lambda: ([], []))
    for s in segs:
        groups[(s["settlement"].id if s["settlement"] else None, s["key"])][0].append(s)
    for d in addrs:
        if d["key"]:
            groups[(d["settlement"].id if d["settlement"] else None, d["key"])][1].append(d)

    streets = []
    type_stats = collections.Counter()
    for (sett_id, key), (gs, gh) in groups.items():
        # union-find по всем элементам группы: линии 0..n-1, дома n..n+m-1
        n, m = len(gs), len(gh)
        parent = list(range(n + m))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(i, j):
            a, b = find(i), find(j)
            if a != b:
                parent[a] = b

        def zone(e):
            return e["zone"].id if e["zone"] is not None else None

        elems = gs + gh
        cross = []        # близкие пары разных типов («улица Каляева» и «проезд Каляева»): решаются после

        def linked(ei, ej, d, i=None, j=None):
            near = d < NEAR_ANY_ZONE or (d < NEAR_SAME_ZONE and zone(ei) == zone(ej))
            if near and ei["typ"] != ej["typ"]:
                if i is not None:
                    cross.append((d, i, j))
                return False
            return near

        lines = [e["line"] for e in gs]
        ltree = STRtree(lines) if n else None
        if n > 1:
            ii, jj = ltree.query(lines, predicate="dwithin", distance=NEAR_SAME_ZONE)
            for i, j in zip(ii.tolist(), jj.tolist()):
                if i < j and linked(gs[i], gs[j], lines[i].distance(lines[j]), i, j):
                    union(i, j)
        lineless = []
        if m:
            pts = shapely.points([(d["x"], d["y"]) for d in gh])
            near_line = [False] * m
            if n:
                ii, jj = ltree.query(pts, predicate="dwithin", distance=NEAR_SAME_ZONE)
                for k, j in zip(ii.tolist(), jj.tolist()):
                    dd = lines[j].distance(pts[k])
                    if linked(gh[k], gs[j], dd, n + k, j):
                        union(n + k, j)
                    if dd < NEAR_ANY_ZONE and gh[k]["typ"] == gs[j]["typ"]:
                        near_line[k] = True
            lineless = [k for k in range(m) if not near_line[k]]
            if lineless:
                lp = pts[lineless]
                htree = STRtree(lp)
                ii, jj = htree.query(lp, predicate="dwithin", distance=NEAR_SAME_ZONE)
                for a, b in zip(ii.tolist(), jj.tolist()):
                    if a < b:
                        ka, kb = lineless[a], lineless[b]
                        if linked(gh[ka], gh[kb], dist((gh[ka]["x"], gh[ka]["y"]), (gh[kb]["x"], gh[kb]["y"])),
                                  n + ka, n + kb):
                            union(n + ka, n + kb)
                # дом у линии и дом без линии рядом — одна улица
                if len(lineless) < m:
                    others = [k for k in range(m) if near_line[k]]
                    otree = STRtree(pts[others])
                    ii, jj = otree.query(lp, predicate="dwithin", distance=NEAR_SAME_ZONE)
                    for a, b in zip(ii.tolist(), jj.tolist()):
                        ka, kb = lineless[a], others[b]
                        if linked(gh[ka], gh[kb], dist((gh[ka]["x"], gh[ka]["y"]), (gh[kb]["x"], gh[kb]["y"])),
                                  n + ka, n + kb):
                            union(n + ka, n + kb)
        if cross:
            merge_cross_types(elems, n, cross, find, parent, type_stats)
        comps = collections.defaultdict(lambda: ([], []))
        for i in range(n):
            comps[find(i)][0].append(i)
        for k in range(m):
            comps[find(n + k)][1].append(gh[k])
        clusters = []
        sett_key = P.all[sett_id].key if sett_id and sett_id in P.all else ""
        same = (gar_sets or {}).get((sett_key, key))
        for ci, hs in comps.values():
            for ci2, hs2 in split_by_zone(gs, ci, hs, type_stats):
                clusters += split_by_numbering(gs, ci2, hs2, same, type_stats)
        for ci, hs in clusters:
            s = Street()
            s.key = key
            s.settlement = P.all.get(sett_id) if sett_id else None
            s.lines = [gs[i] for i in ci]
            s.houses = hs
            tc = collections.Counter(e["typ"] for e in s.lines + hs if e["typ"])
            s.typ = tc.most_common(1)[0][0] if tc else ""
            for seg in s.lines:
                s.variants[("line", seg["name"])] += 1
                for a in seg["alts"]:
                    s.variants[("alt", a)] += 1
            for d in hs:
                s.variants[("addr", d["street"])] += 1
            # зона улицы: СНТ, если в нём больше половины домов (или длины линий, если домов нет)
            z = collections.Counter()
            for d in hs:
                z[d["zone"].id if d["zone"] else None] += 1
            if not hs:
                for seg in s.lines:
                    z[seg["zone"].id if seg["zone"] else None] += seg["line"].length
            zid, zc = z.most_common(1)[0]
            s.zone = P.all.get(zid) if zid and zc > 0.5 * sum(z.values()) else None
            s.place = s.zone or s.settlement
            streets.append(s)
    log("улиц OSM", len(streets), dict(type_stats))
    cluster_streets.stats = dict(type_stats)
    return streets, addrs


def merge_cross_types(elems, n, cross, find, parent, type_stats):
    """Близкие элементы одного имени и разных типов. Каждый тип сначала собирается отдельно («улица Каляева» и
    «проезд Каляева» — разные улицы). Затем, от ближних пар к дальним:
      - безтиповый кусок («Каляева» в addr:street) присоединяется к ближайшей типизированной улице;
      - дома типа T без линий присоединяются к улице другого типа с линиями, только если линий типа T в группе
        нет вовсе (ошибка типа в addr:street: «улица Чекистов» у линии «проспект Чекистов»)."""
    ctyp, cline = {}, collections.defaultdict(bool)
    line_types = {elems[i]["typ"] for i in range(n)}
    apart = set()
    for i, e in enumerate(elems):
        r = find(i)
        ctyp[r] = e["typ"]
        if i < n:
            cline[r] = True
    for d, i, j in sorted(cross):
        a, b = find(i), find(j)
        if a == b:
            continue
        ta, tb = ctyp[a], ctyp[b]
        if ta == tb:
            join = True
        elif not ta or not tb:
            join = True
            type_stats["untyped_joined"] += 1
        elif (not cline[a] and ta not in line_types and cline[b]) or (not cline[b] and tb not in line_types and cline[a]):
            join = True
            type_stats["type_mismatch_joined"] += 1
        else:
            if (a, b) not in apart:
                apart.add((a, b))
                type_stats["same_name_other_type_kept_apart"] += 1
            continue
        if join:
            parent[a] = b
            ctyp[b] = tb if (tb and cline[b]) or not ta else ta
            cline[b] = cline[a] or cline[b]


def split_by_zone(gs, ci, hs, type_stats):
    """Улица, дома которой лежат в разных СНТ и повторяют номера (два дома «62» в СНТ «Связист» и «КТТУ» за
    250 м) — это одноимённые улицы разных СНТ: делим по СНТ. Линии — к СНТ своей середины, иначе к ближайшей
    части."""
    zones = collections.defaultdict(list)
    for d in hs:
        zones[d["zone"].id if d["zone"] is not None else None].append(d)
    if len(zones) < 2:
        return [(ci, hs)]
    seen = {}
    clash = False
    for z, ds in zones.items():
        for d in ds:
            for z2, d2 in seen.get(d["norm"], []):
                if z2 != z and dist((d["x"], d["y"]), (d2["x"], d2["y"])) > 50:
                    clash = True
            seen.setdefault(d["norm"], []).append((z, d))
    if not clash:
        return [(ci, hs)]
    type_stats["split_by_snt"] += 1
    parts = {z: ([], ds) for z, ds in zones.items()}
    for i in ci:
        seg = gs[i]
        z = seg["zone"].id if seg["zone"] is not None else None
        if z not in parts:
            z = min(parts, key=lambda zz: min(seg["line"].distance(Point(d["x"], d["y"])) for d in parts[zz][1]))
        parts[z][0].append(i)
    return list(parts.values())


CLASH_M = 200.0          # м: один номер дальше — это другой дом (другая нумерация), а не второй объект того же
SPLIT_MIN_ADDRS = 4      # часть улицы при делении по нумерации — не меньше стольких адресов, иначе — к соседней
SPLIT_MIN_SHARE = 0.15   # и не меньше такой доли её номеров повторяется в другой части (своя нумерация)


def split_by_numbering(gs, ci, hs, gar_sets, type_stats):
    """Одна «улица» из OSM, в которой слиплись две одноимённые улицы пункта: номера повторяются дальше CLASH_M, и ГАР
    знает в пункте ≥2 улицы с этим именем (gar_sets — [(тип, номера домов)] этих улиц ГАР). Делим, только если ГАР
    подтверждает: номера отделяемой части ≥50 % — у другой улицы ГАР и заметно лучше (+20 % номеров), чем у улицы
    ГАР основной части. Без подтверждения повторы — ошибки OSM или корпуса одного адреса («Калинина, 13/…» —
    кампус КубГАУ), копию выбирает osm_houses; нумерации СНТ «1…N» ГАР не различает — тоже не делим.
    Деление — одиночная связь с запретом: части сливаются по возрастанию расстояния между домами, пока в одной
    части не окажутся два дома с одним номером дальше CLASH_M. Мелкие и неподтверждённые части — к ближайшей
    принятой. Линии — к части с ближайшим домом."""
    if len(hs) < 2 * SPLIT_MIN_ADDRS:
        return [(ci, hs)]
    byn = collections.defaultdict(list)
    for k, d in enumerate(hs):
        byn[d["norm"]].append(k)
    xy = np.array([(d["x"], d["y"]) for d in hs])
    clash = 0
    for ks in byn.values():
        if len(ks) > 1:
            p = xy[ks]
            if np.max(np.hypot(p[:, None, 0] - p[None, :, 0], p[:, None, 1] - p[None, :, 1])) > CLASH_M:
                clash += 1
    if clash < 2 or not gar_sets:
        return [(ci, hs)]
    tc = collections.Counter(d["typ"] for d in hs if d["typ"])
    typ = tc.most_common(1)[0][0] if tc else ""
    gsets = [ns for t, ns in gar_sets if not typ or not t or t == typ]
    if len(gsets) < 2:
        return [(ci, hs)]
    m = len(hs)
    dm = np.hypot(xy[:, None, 0] - xy[None, :, 0], xy[:, None, 1] - xy[None, :, 1])
    iu, ju = np.triu_indices(m, 1)
    order = np.argsort(dm[iu, ju], kind="stable")
    parent = list(range(m))
    members = {k: {hs[k]["norm"]: [k]} for k in range(m)}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def compatible(a, b):
        ma, mb = members[a], members[b]
        if len(ma) > len(mb):
            ma, mb = mb, ma
        for n, ks in ma.items():
            other = mb.get(n)
            if other and any(dm[i, j] > CLASH_M for i in ks for j in other):
                return False
        return True

    ncomp = m
    for e in order.tolist():
        a, b = find(int(iu[e])), find(int(ju[e]))
        if a == b or not compatible(a, b):
            continue
        if sum(len(v) for v in members[a].values()) > sum(len(v) for v in members[b].values()):
            a, b = b, a
        parent[a] = b
        for n, ks in members.pop(a).items():
            members[b].setdefault(n, []).extend(ks)
        ncomp -= 1
        if ncomp == 1:
            break
    comps = collections.defaultdict(list)
    for k in range(m):
        comps[find(k)].append(k)
    # часть — отдельная улица, только если это своя нумерация: ≥ SPLIT_MIN_SHARE её номеров повторяются в другой
    # части дальше CLASH_M. Иначе (несколько копий-ошибок на одной длинной улице: «улица 1-го Мая» — 4 повтора на
    # 900 номеров) часть возвращается к ближайшей, и копию выбирает osm_houses.
    parts_k = sorted(comps.values(), key=len, reverse=True)
    kept = [parts_k[0]]
    main_own = {hs[k]["norm"] for k in parts_k[0]}
    gm = max(range(len(gsets)), key=lambda g: len(main_own & gsets[g]))
    for ks in parts_k[1:]:
        kset = set(ks)
        own = {hs[k]["norm"] for k in ks}
        clash_n = 0
        for n in own:
            inn = [k for k in byn[n] if k in kset]
            out = [k for k in byn[n] if k not in kset]
            if out and float(np.max(dm[np.ix_(inn, out)])) > CLASH_M:
                clash_n += 1
        if len(ks) < SPLIT_MIN_ADDRS or clash_n < 2 or clash_n < SPLIT_MIN_SHARE * len(own):
            continue
        ov_main = len(own & gsets[gm])
        ov_alt = max(len(own & gsets[g]) for g in range(len(gsets)) if g != gm)
        if ov_alt >= 0.5 * len(own) and ov_alt >= ov_main + 0.2 * len(own):
            kept.append(ks)
    rest = [ks for ks in parts_k if not any(ks is k for k in kept)]
    big = [list(ks) for ks in kept]
    if len(big) < 2:
        return [(ci, hs)]
    for ks in rest:
        j = min(range(len(big)), key=lambda t: float(np.min(dm[np.ix_(ks, big[t])])))
        big[j] = big[j] + ks
    parts = [([], [hs[k] for k in ks]) for ks in big]
    for i in ci:
        line = gs[i]["line"]
        j = min(range(len(parts)), key=lambda t: min(line.distance(Point(d["x"], d["y"])) for d in parts[t][1]))
        parts[j][0].append(i)
    type_stats["split_by_numbering"] += 1
    type_stats["split_by_numbering_parts"] += len(parts)
    return parts


def name_street(s, gar_name=None, gar_type=None):
    """Каноническое имя и тип: самое частое написание линий (иначе addr:street, иначе ГАР); ё — если есть
    хоть в одном написании; «им.» — прочь, инициалы остаются (короткое имя без них — в синонимах)."""
    lines = collections.Counter({n: c for (k, n), c in s.variants.items() if k == "line"})
    addrs = collections.Counter({n: c for (k, n), c in s.variants.items() if k == "addr"})
    src = lines or addrs
    variants = [n for (k, n) in s.variants]
    if gar_name:
        variants.append(gar_name)
    if src:
        best = max(src.items(), key=lambda kv: (kv[1], "ё" in kv[0].lower(), -len(kv[0])))[0]
    else:
        best = gar_name
    core, typ = tn.split_street(best)
    if not typ:
        for v in variants:
            _, t = tn.split_street(v)
            if t:
                typ = t
                break
    if gar_type and not typ:
        typ = gar_type
    # инициалы, как на табличке и в ГАР, остаются в подписи («улица Кобцевой Н.С.»), «им.» — нет;
    # короткое имя («улица Кобцевой») — в синонимах
    core = tn.pretty_full(core)
    # ё: если где-то имя с ё и совпадает с нашим по буквам
    for v in variants:
        c2 = tn.pretty_full(tn.split_street(v)[0])
        if "ё" in c2.lower() and c2.lower().replace("ё", "е") == core.lower().replace("ё", "е"):
            core = c2
            break
    s.type = typ
    s.name = tn.canonical_street(core, typ)
    # синонимы: сначала полные имена с инициалами и званиями (официальное имя ГАР — первым: «улица Кобцевой Н.С.»),
    # затем короткие формы других написаний и сами написания как есть
    full, short, raw = [], [], []
    for v in ([gar_name] if gar_name else []) + variants:
        v = tn.clean(v)
        if not v:
            continue
        c, t = tn.split_street(v)
        full.append(tn.canonical_street(tn.pretty_full(c), t or typ))
        short.append(tn.canonical_street(tn.pretty_core(c), t or typ))
        raw.append(v)
    seen = {s.name.lower()} | {x.lower() for x in s.aliases}
    for a in full + short + raw:
        if a.lower() not in seen:
            seen.add(a.lower())
            s.aliases.append(a)
    s.aliases = s.aliases[:16]


def street_point(s):
    """Точка улицы: середина самой длинной связной части линии; без линий — дом, ближайший к среднему."""
    if s.lines:
        merged = linemerge(MultiLineString([seg["line"] for seg in s.lines]))
        parts = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
        longest = max(parts, key=lambda g: g.length)
        p = longest.interpolate(0.5, normalized=True)
        return p.x, p.y
    return None


def snap_nodes(osm, addrs):
    """Адресный узел внутри здания без адреса → точка здания; рядом (≤15 м) единственное такое здание → оно же."""
    bare = [b for b in osm["bare"] if b["wkb"] is not None]
    polys = [geom_m(b["wkb"]) for b in bare]
    tree = STRtree(polys)
    nodes = [d for d in addrs if d["a"]["kind"] == "node" and not d["a"].get("entrance")]
    if not nodes:
        return 0
    pts = shapely.points([(d["x"], d["y"]) for d in nodes])
    pi, gi = tree.query(pts, predicate="within")
    inside = {}
    for a, b in zip(pi.tolist(), gi.tolist()):
        inside[a] = b
    snapped = 0
    for k, d in enumerate(nodes):
        b = inside.get(k)
        if b is None:
            cand = tree.query(pts[k], predicate="dwithin", distance=15).tolist()
            if len(cand) == 1:
                b = cand[0]
        if b is not None:
            bx, by = to_m(bare[b]["lon"], bare[b]["lat"])
            d["x"], d["y"] = bx, by
            d["snapped"] = True
            snapped += 1
    return snapped


def osm_houses(P, streets, addrs, locate_settlement, locate_snt):
    """Дома OSM: (улица, номер) — один дом; дубли склеиваются: здание важнее точки, большее здание важнее,
    далёкие (>300 м) копии — та группа, где больше объектов."""
    street_of = {}
    for s in streets:
        for d in s.houses:
            street_of[id(d)] = s
    # addr:place без улицы → СНТ/микрорайон/пункт по имени рядом, иначе новое место
    place_only = [d for d in addrs if not d["key"] and d["place"]]
    by_key = collections.defaultdict(list)
    for p in list(P.snts) + list(P.micro) + list(P.settlements):
        k = p.key if p.kind == "snt" else tn.place_key(p.name)
        by_key[k].append(p)
        for a in p.aliases:
            by_key[tn.snt_key(a) if p.kind == "snt" else tn.place_key(a)].append(p)
    new_places = {}
    for d in place_only:
        lab = d["place"]
        snt = tn.is_snt_label(lab)
        k = tn.snt_key(lab) if snt else tn.place_key(lab)
        best = None
        for p in by_key.get(k, []):
            dd = dist((p.x, p.y), (d["x"], d["y"]))
            if dd < 5000 and (best is None or dd < best[0]):
                best = (dd, p)
        if best:
            d["place_obj"] = best[1]
            continue
        sett = d["settlement"]
        nk = ("snt" if snt else "micro", sett.id if sett else None, k)
        if nk not in new_places:
            name = f"СНТ {tn.snt_core(lab)}" if snt else tn.clean(lab)
            pl = Place(sid("p", "osm-place:" + "|".join(str(x) for x in nk)), "snt" if snt else "microdistrict",
                       name, d["x"], d["y"], None)
            pl.key = k
            pl.settlement = sett
            pl.parent = sett.id if sett else None
            pl._pts = []
            new_places[nk] = pl
        new_places[nk]._pts.append((d["x"], d["y"]))
        d["place_obj"] = new_places[nk]
    for pl in new_places.values():
        xs = sorted(p[0] for p in pl._pts)
        ys = sorted(p[1] for p in pl._pts)
        pl.x, pl.y = xs[len(xs) // 2], ys[len(ys) // 2]
        del pl._pts
    # одно имя рядом (≤ MICRO_SAME_M), но дома по разные стороны границы пункта — одно место
    kept, remap = [], {}
    for pl in sorted(new_places.values(), key=lambda p: p.id):
        same = next((q for q in kept if q.kind == pl.kind and q.key == pl.key
                     and dist((q.x, q.y), (pl.x, pl.y)) < MICRO_SAME_M), None)
        if same is not None:
            remap[pl.id] = same
            continue
        kept.append(pl)
        P.add(pl)
        (P.snts if pl.kind == "snt" else P.micro).append(pl)
    if remap:
        for d in place_only:
            po = d.get("place_obj")
            if po is not None and po.id in remap:
                d["place_obj"] = remap[po.id]
    log("addr:place без улицы:", len(place_only), "новых мест", len(new_places))

    # группы (улица|место, номер)
    groups = collections.defaultdict(list)
    for d in addrs:
        s = street_of.get(id(d))
        if s is not None:
            groups[("s", id(s), d["norm"])].append((s, d))
        elif d.get("place_obj") is not None:
            groups[("p", d["place_obj"].id, d["norm"])].append((None, d))
    houses = []
    dup_far = 0
    osm_houses.by_prediction = 0
    for (_, _, norm), items in groups.items():
        # разнесённые копии: кластер по 300 м, берём самый «весомый»
        if len(items) > 1:
            cl = []
            for it in items:
                d = it[1]
                for c in cl:
                    if dist((c[0][1]["x"], c[0][1]["y"]), (d["x"], d["y"])) < 300:
                        c.append(it)
                        break
                else:
                    cl.append([it])
            if len(cl) > 1:
                dup_far += 1
                s0 = items[0][0]
                pick = predicted_copy(s0, norm, cl) if s0 is not None else None
                if pick is not None:
                    osm_houses.by_prediction += 1
                    items = pick
                else:
                    sib = s0.houses if s0 is not None else []
                    items = max(cl, key=lambda c: (siblings_near(c[0][1], sib), len(c),
                                                   max(i[1]["a"]["area"] for i in c)))
            else:
                items = cl[0]
        rep = max(items, key=lambda it: (it[1]["a"]["kind"] == "area", it[1]["a"]["area"],
                                         bool(it[1].get("snapped")), it[1]["a"]["kind"] == "node"))
        s, d = rep
        post = next((it[1]["a"].get("addr:postcode") for it in items if it[1]["a"].get("addr:postcode")), None)
        post = post if post and re.fullmatch(r"\d{6}", post.strip()) else None
        number = collections.Counter(it[1]["number"] for it in items).most_common(1)[0][0]
        place = s.place if s is not None else d["place_obj"]
        h = House(s, place, number, norm, d["x"], d["y"], "house", "osm", post, d["a"]["osm"], None,
                  d["a"]["area"])
        houses.append(h)
    log("домов OSM после склейки", len(houses), "разнесённых копий", dup_far)
    osm_houses.dup_far = dup_far
    return houses


def predicted_copy(s, norm, clusters):
    """Какая из далёких копий адреса (два объекта OSM с одной улицей и номером) стоит на своём месте в нумерации:
    точка номера по соседям улицы (те же правила, что у интерполяции ГАР, без домов этой целой части и без других
    номеров с копиями). Берём копию, если она ближе 150 м к оценке, а остальные — заметно дальше; иначе None."""
    b = tn.number_base(norm)
    if b is None:
        return None
    far = getattr(s, "_far_norms", None)
    if far is None:
        pos = collections.defaultdict(list)
        for d in s.houses:
            pos[d["norm"]].append((d["x"], d["y"]))
        far = {n for n, ps in pos.items() if len(ps) > 1 and max(dist(a, c) for a in ps for c in ps) >= 300}
        s._far_norms = far
    hs = [House(None, None, d["number"], d["norm"], d["x"], d["y"], "house", "osm") for d in s.houses
          if d["norm"] not in far and tn.number_base(d["norm"]) != b]
    e = NumberLine(hs, s.zone is not None).estimate(norm)
    if e is None and s.lines:
        e = LineModel(s, hs).estimate(norm)
    if e is None:
        return None
    ds = sorted((min(dist((e[0], e[1]), (it[1]["x"], it[1]["y"])) for it in c), i) for i, c in enumerate(clusters))
    if ds[0][0] <= 150 and ds[1][0] >= 2 * ds[0][0] + 100:
        return clusters[ds[0][1]]
    return None


def number_related(a, b):
    """Номера-соседи: «14/5» ~ «14/5Б», «14/4», «14/6»; «9» ~ «7», «11», «9а». Для выбора копии дома."""
    ma, mb = re.match(r"^(\d+)(?:/(\d+))?", a), re.match(r"^(\d+)(?:/(\d+))?", b)
    if not ma or not mb or a == b:
        return False
    if ma.group(0) == mb.group(0):
        return True
    if ma.group(1) != mb.group(1):
        if ma.group(2) or mb.group(2):
            return False
        x, y = int(ma.group(1)), int(mb.group(1))
        return x % 2 == y % 2 and abs(x - y) <= 4
    if ma.group(2) and mb.group(2):
        return abs(int(ma.group(2)) - int(mb.group(2))) <= 2
    return False


def siblings_near(d, sib, radius=150.0):
    """Сколько соседних номеров той же улицы рядом с копией дома: правильная копия стоит среди соседей."""
    return sum(1 for o in sib if o is not d and number_related(d["norm"], o["norm"])
               and dist((o["x"], o["y"]), (d["x"], d["y"])) < radius)


# ---------------------------------------------------------------- 5. ГАР

GAR_SNT_TYPES = {"снт", "тер. снт", "тер. днт", "тер. тсн", "тер. спк", "тер. дно", "днт", "тсн", "тер. сн"}
GAR_MICRO_TYPES = {"мкр.", "кв-л", "ж/р", "п/р"}
GAR_SKIP_HOUSETYPES = {"г-ж", "шахта", "подв.", "кот.", "п-б", "ОНС"}


def read_gar(gar_dir):
    objs = {}
    with open(os.path.join(gar_dir, "gar_objects.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            r["objectid"] = int(r["objectid"])
            r["level"] = int(r["level"])
            r["settlement"] = int(r["settlement"] or 0)
            r["plan"] = int(r["plan"] or 0)
            objs[r["objectid"]] = r
    houses = []
    with open(os.path.join(gar_dir, "gar_houses.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            houses.append(r)
    ver = open(os.path.join(gar_dir, "version.txt")).read().strip() if os.path.exists(
        os.path.join(gar_dir, "version.txt")) else "unknown"
    return objs, houses, ver


VOWELS = set("аоеёиыяэюу")


def same_digits(a, b):
    """Числа в именах совпадают: «2-й Темрюкский» ≠ «3-й Темрюкский», «35-я Линия» ≠ «36-я Линия»."""
    return re.findall(r"\d+", a) == re.findall(r"\d+", b)


def spelling_variant(a, b):
    """Разночтение в одну букву, которое не меняет имя: гласная ↔ гласная («Фелицына»/«Фелицина», «Деповской»/
    «Деповский», «Алычовая»/«Алычёвая»), удвоенная согласная («Тросовая»/«Троссовая»), ь/ъ. «Калиновая»/«Малиновая»,
    «Кроткий»/«Короткий», «Въездная»/«Выездная» — разные имена."""
    if a == b or not same_digits(a, b) or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [(x, y) for x, y in zip(a, b) if x != y]
        return len(diff) == 1 and diff[0][0] in VOWELS and diff[0][1] in VOWELS
    if len(a) < len(b):
        a, b = b, a                                   # a длиннее на одну букву
    for i in range(len(a)):
        if a[:i] + a[i + 1:] == b:
            ch = a[i]
            return ch in "ьъ" or (i > 0 and a[i - 1] == ch) or (i + 1 < len(a) and a[i + 1] == ch)
    return False


def gar_same_name_streets(gar_objs, gar_houses):
    """Одноимённые улицы ГАР одного пункта (разные СНТ/массивы: «ул. Калинина» г. Краснодар — центр, «Пашковский
    жилой массив», «ТЭЦ жилой массив»): (ключ пункта, ключ улицы) → [(тип, номера домов)], только где улиц ≥2."""
    nums = collections.defaultdict(set)
    for r in gar_houses:
        st = int(r["street"] or 0)
        if st:
            nums[st].add(tn.number_norm(tn.gar_number(r["housenum"], r["addtype1"], r["addnum1"], r["addtype2"],
                                                      r["addnum2"])))
    out = collections.defaultdict(list)
    for o in gar_objs.values():
        if o["level"] == 8 and o["settlement"] in gar_objs:
            full = f"{o['type']} {o['name']}"
            out[(tn.place_key(gar_objs[o["settlement"]]["name"]), tn.street_key(full))].append(
                (tn.effective_type(full), nums.get(o["objectid"], set())))
    return {k: v for k, v in out.items() if len(v) > 1}


def is_gar_snt(obj):
    t = obj["type"].lower()
    if t in GAR_SNT_TYPES:
        return True
    return t in ("тер.", "тер") and bool(re.search(r"(?i)\b(снт|днт|тсн|ст|нст|сот)\b", obj["name"]))


LETTERS = "абвгдежзиклмнопрстуфхцчшщэюя"


SUB_KINDS = {"": 0, "/": 1, "к": 2, "с": 3, "стр": 3, "лит": 4}


def sub_parts(norm):
    """Номер → (целая часть, [(вид, значение), …]): «21» → (21, []); «21а» → (21, [(0, 1)]); «21/3» → (21, [(1, 3)]);
    «21к2» → (21, [(2, 2)]); «36ак11» → (36, [(0, 1), (2, 11)]); «401в/1» → (401, [(0, 3), (1, 1)])."""
    m = re.match(r"^(\d{1,5})(.*)$", norm or "")
    if not m:
        return None
    comps = []
    for pre, num, let in re.findall(r"(стр|лит|к|с|/)?(\d+)|([а-я])", m.group(2)):
        if num:
            comps.append((SUB_KINDS.get(pre, 1), int(num)))
        elif let:
            comps.append((0, LETTERS.index(let) + 1 if let in LETTERS else 30))
    return int(m.group(1)), comps


def fine_pos(norm):
    """Положение номера на улице в единицах номера, строго внутри [b, b+1): «21» → 21; «21а» < «21б» < «21/1» <
    «21к1» < … < 22. Разные номера — разные позиции (без «потолка»: «50/15» и «50/84», «89и» и «89к» не совпадают):
    вид хвоста — полоса 0,2, значение внутри полосы — 0,2·(1 − 1/(1 + v/3)), следующий хвост — в 10 раз мельче."""
    sp = sub_parts(norm)
    if sp is None:
        return None
    b, comps = sp
    if not comps:
        return float(b)
    frac, scale = 0.02, 0.85
    for kind, v in comps[:3]:
        frac += scale * (min(kind, 4) * 0.2 + 0.2 * (1.0 - 1.0 / (1.0 + v / 3.0)))
        scale *= 0.1
    return b + frac


def spread_positions(norms):
    """Позиции номеров улицы с «разводкой» хвостов: номера одной целой части с хвостами («50/1» … «50/84», «89д» …
    «89н») по порядку fine_pos встают на отрезок к следующему номеру с шагом min(0,12; 0,9/(n+1)) — у каждого своя
    точка, а не одна на всех. Одиночный «21а» — 21,12, как раньше."""
    by_base = collections.defaultdict(set)
    for n in norms:
        sp = sub_parts(n)
        if sp is not None and sp[1]:
            by_base[sp[0]].add(n)
    pos = {}
    for b, ns in by_base.items():
        order = sorted(ns, key=fine_pos)
        step = min(0.12, 0.9 / (len(order) + 1))
        for i, n in enumerate(order):
            pos[n] = b + step * (i + 1)
    return pos


CROWDED_TAILS = 8          # у целой части столько номеров с хвостом («8/1» … «8/73») — это комплекс, не дом


def make_pos(norms):
    """Функция позиции для улицы: разведённые хвосты (spread_positions), остальные — fine_pos. У функции атрибут
    crowded — целые части с ≥CROWDED_TAILS номерами-хвостами: их точки на отрезке — сантиметры друг от друга, «до дома»
    их не поставить."""
    sp = spread_positions(norms)
    cnt = collections.Counter(sub_parts(n)[0] for n in sp)

    def pos(n):
        return sp.get(n) if n in sp else fine_pos(n)

    pos.crowded = {b for b, c in cnt.items() if c >= CROWDED_TAILS}
    return pos


INTERPOLATED_METHODS = {"same_parity", "any_parity"}


class NumberLine:
    """Положение номера на улице по известным точкам (дома OSM той же улицы). Номер → «позиция» fine_pos:
    same_base — есть дом OSM с той же целой частью: простой номер («21» при «21к1») — его точка; номер
                 с хвостом («21к2», «21/3», «21а») — от него вдоль отрезка к соседу той же чётности по позиции;
    same_parity — между соседями той же чётности (разрыв ≤20 номеров, соседи ≤150 м);
    any_parity — только в СНТ (участки часто нумеруют подряд): между номерами любой чётности, разрыв ≤4;
                 в городе противоположная сторона сдвинута — по проверке «исключи один» медиана 80 м, не берём;
    extrapolated — за краем известных номеров той же чётности не дальше EXTRA_MAX номеров, по двум крайним
                 соседям (≤150 м), не дальше EXTRA_CAP_M от края.
    Иначе — None (точка улицы)."""

    MAX_PAIR_M = 150.0
    EXTRA_MAX = 4
    EXTRA_CAP_M = 60.0

    def __init__(self, houses, snt=False, pos=None):
        self.pos = pos or fine_pos
        self.by_base = collections.defaultdict(list)
        ent = {}
        for h in houses:
            if h.base is None:
                continue
            self.by_base[h.base].append(h)
            f = self.pos(h.norm)
            if f is not None and f not in ent:
                ent[f] = (h.x, h.y, h.base)
        self.fines = sorted(ent)
        self.pt = ent
        self.par = {0: [f for f in self.fines if ent[f][2] % 2 == 0], 1: [f for f in self.fines if ent[f][2] % 2 == 1]}
        self.snt = snt

    def point(self, q):
        hs = self.by_base[q]
        h = min(hs, key=lambda h: (h.norm != str(q), len(h.norm)))
        return h.x, h.y

    def _bracket(self, arr, f, max_gap):
        i = bisect.bisect_left(arr, f)
        if i == 0 or i >= len(arr):
            return None
        lo, hi = arr[i - 1], arr[i]
        if hi - lo > max_gap:
            return None
        p1, p2 = self.pt[lo][:2], self.pt[hi][:2]
        if dist(p1, p2) > self.MAX_PAIR_M:
            return None
        t = (f - lo) / (hi - lo)
        return p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t

    def _extrapolate(self, arr, f):
        i = bisect.bisect_left(arr, f)
        if len(arr) < 2:
            return None
        if i == 0:
            q1, q2 = arr[0], arr[1]
        elif i >= len(arr):
            q1, q2 = arr[-1], arr[-2]
        else:
            return None
        if abs(q1 - f) > self.EXTRA_MAX or abs(q2 - q1) > 6 or q1 == q2:
            return None
        p1, p2 = self.pt[q1][:2], self.pt[q2][:2]
        d12 = dist(p1, p2)
        if d12 > self.MAX_PAIR_M or d12 < 1:
            return None
        k = (f - q1) / (q1 - q2)          # сколько шагов «q2 → q1» пройти дальше края
        dx, dy = (p1[0] - p2[0]) * k, (p1[1] - p2[1]) * k
        L = math.hypot(dx, dy)
        if L > self.EXTRA_CAP_M:
            dx, dy = dx * self.EXTRA_CAP_M / L, dy * self.EXTRA_CAP_M / L
        return p1[0] + dx, p1[1] + dy

    def _from_anchor(self, b, f):
        """Номер с хвостом при доме OSM той же целой части: отрезок «ближайший по позиции дом этой целой части →
        сосед той же чётности по другую сторону от позиции». Соседа нет — точка самого дома (уточнить нечем)."""
        # сначала соседи той же стороны (чётности), затем — любой (другая сторона улицы / СНТ подряд)
        for arr in (self.par[b % 2], self.fines):
            i = bisect.bisect_left(arr, f)
            lo = arr[i - 1] if i > 0 else None
            hi = arr[i] if i < len(arr) else None
            if hi is not None and hi == f:
                return self.pt[hi][:2], True
            for a, o in ((lo, hi), (hi, lo)):
                if a is None or self.pt[a][2] != b:
                    continue
                if o is None or abs(o - a) > 20 or dist(self.pt[a][:2], self.pt[o][:2]) > self.MAX_PAIR_M:
                    continue
                t = (f - a) / (o - a)
                p1, p2 = self.pt[a][:2], self.pt[o][:2]
                return (p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t), False
        # соседей ближе 150 м нет — уточнить нечем: точка самого дома той же целой части
        return self.point(b), True

    def estimate(self, norm, exclude_self=False):
        """(x, y, способ, общая_точка) или None. общая_точка — точка совпала с точкой другого дома."""
        b = tn.number_base(norm)
        f = self.pos(norm)
        if b is None or f is None:
            return None
        if b in self.by_base and not exclude_self:
            (x, y), shared = self._from_anchor(b, f)
            return x, y, "same_base", shared
        order = [("same_parity", self.par[b % 2], 20)]
        if self.snt:
            order.append(("any_parity", self.fines, 4))
        for name, arr, gap in order:
            r = self._bracket(arr, f, gap)
            if r is not None:
                return r[0], r[1], name, False
        r = self._extrapolate(self.par[b % 2], f)
        if r is not None:
            return r[0], r[1], "extrapolated", False
        return None


class LineModel:
    """Положение номера вдоль линии улицы, когда соседей той же чётности ближе 150 м нет (редко размеченная
    улица): дома OSM проецируются на линию → пары (позиция номера, метры вдоль линии). Номер ставится между
    двумя такими домами любой чётности (разрыв ≤ LINE_GAP номеров, ≤ LINE_SPAN_M по линии), за краем — не дальше
    LINE_EXTRA номеров и LINE_EXTRA_M метров. Сторона улицы — как у ближайшего дома той же чётности, отступ от оси —
    медиана отступов домов этой стороны. Проверка «исключи один» — в отчёте (line / line_far)."""

    SNAP_M = 60.0          # дом дальше от линии — не опора
    LINE_GAP = 60
    LINE_SPAN_M = 800.0
    LINE_EXTRA = 10
    LINE_EXTRA_M = 150.0
    MAX_RATE = 40.0        # м на номер: больше — опоры с разных концов/веток, не верим

    def __init__(self, street, houses, pos=None):
        self.pos = pos or fine_pos
        self.ok = False
        if not street.lines:
            return
        merged = linemerge(MultiLineString([seg["line"] for seg in street.lines]))
        self.parts = [g for g in (merged.geoms if merged.geom_type == "MultiLineString" else [merged])
                      if g.length > 20]
        if not self.parts:
            return
        self.anchors = collections.defaultdict(list)       # часть → [(fine, s, lateral, parity)]
        for h in houses:
            f = self.pos(h.norm)
            if f is None:
                continue
            pt = Point(h.x, h.y)
            k = min(range(len(self.parts)), key=lambda i: self.parts[i].distance(pt))
            part = self.parts[k]
            if part.distance(pt) > self.SNAP_M:
                continue
            sa = part.project(pt)
            (bx, by), (tx, ty) = self._frame(part, sa)
            lat = (h.x - bx) * -ty + (h.y - by) * tx       # со знаком: слева от направления линии — плюс
            self.anchors[k].append((f, sa, lat, h.base % 2))
        for k in self.anchors:
            self.anchors[k].sort()
        self.ok = any(len(v) >= 2 for v in self.anchors.values())

    @staticmethod
    def _frame(part, sa):
        L = part.length
        a = part.interpolate(max(0.0, sa - 2.0))
        b = part.interpolate(min(L, sa + 2.0))
        tx, ty = b.x - a.x, b.y - a.y
        n = math.hypot(tx, ty) or 1.0
        p = part.interpolate(sa)
        return (p.x, p.y), (tx / n, ty / n)

    def _side(self, anc, sa, parity):
        same = [a for a in anc if a[3] == parity]
        if not same:
            return 0.0
        near = min(same, key=lambda a: abs(a[1] - sa))
        mags = sorted(abs(a[2]) for a in same)
        mag = min(mags[len(mags) // 2], 40.0)
        return math.copysign(mag, near[2])

    def estimate(self, norm):
        """(x, y, способ) или None; способ: line — между опорами, line_far — за краем."""
        if not self.ok:
            return None
        f = self.pos(norm)
        b = tn.number_base(norm)
        if f is None or b is None:
            return None
        best = None
        for k, anc_all in self.anchors.items():
            # только та же сторона: чётная и нечётная стороны нумеруются вразнобой (опоры другой стороны — медиана 90 м)
            anc = [a for a in anc_all if a[3] == b % 2]
            if len(anc) < 2:
                continue
            fs = [a[0] for a in anc]
            i = bisect.bisect_left(fs, f)
            if 0 < i < len(anc):
                lo, hi = anc[i - 1], anc[i]
                if hi[0] - lo[0] > self.LINE_GAP or abs(hi[1] - lo[1]) > self.LINE_SPAN_M or hi[0] == lo[0]:
                    continue
                if abs(hi[1] - lo[1]) / (hi[0] - lo[0]) > self.MAX_RATE:
                    continue
                t = (f - lo[0]) / (hi[0] - lo[0])
                sa = lo[1] + (hi[1] - lo[1]) * t
                cand = (hi[0] - lo[0], k, sa, "line")
            else:
                q1, q2 = (anc[0], anc[1]) if i == 0 else (anc[-1], anc[-2])
                if abs(q1[0] - f) > self.LINE_EXTRA or q1[0] == q2[0] or abs(q1[0] - q2[0]) > self.LINE_GAP:
                    continue
                rate = (q1[1] - q2[1]) / (q1[0] - q2[0])
                if abs(rate) > self.MAX_RATE or abs(rate) < 0.5:
                    continue
                ds = max(-self.LINE_EXTRA_M, min(self.LINE_EXTRA_M, rate * (f - q1[0])))
                sa = min(max(q1[1] + ds, 0.0), self.parts[k].length)
                cand = (1000 + abs(q1[0] - f), k, sa, "line_far")
            if best is None or cand[0] < best[0]:
                best = cand
        if best is None:
            return None
        _, k, sa, method = best
        part = self.parts[k]
        (bx, by), (tx, ty) = self._frame(part, sa)
        lat = self._side(self.anchors[k], sa, b % 2)
        return bx - ty * lat, by + tx * lat, method


EVAL_TYPES = {"улица", "проспект", "переулок", "проезд", "бульвар", "площадь", "шоссе", "набережная", "микрорайон",
              "тупик", "аллея", "квартал", "территория"}


def eval_split(s):
    """Часть замера (data/geocoder/research/eval/geotext.split_of): sha1 ядра имени улицы с солью → 60/20/20."""
    names = [n for (k, n) in s.variants if k in ("line", "addr")]
    if not names:
        return "none"
    words = re.sub(r"\s+", " ", re.sub(r"[^0-9a-zа-я/]+", " ", names[0].lower().replace("ё", "е"))).strip().split()
    core, typ = [], None
    for w in words:
        if w in EVAL_TYPES and typ is None:
            typ = w
            continue
        if w in ("имени", "им"):
            continue
        core.append(w)
    c = " ".join(core) or " ".join(words)
    h = int(hashlib.sha1(f"inrenta-geo-eval-v1:{c}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "train" if h < 0.6 else ("val" if h < 0.8 else "test")


def validate_interpolation(streets, sample=8000, seed=7):
    """Проверка «исключи один» на домах OSM: прячем простой номер («21»), оцениваем его точку по соседям
    теми же правилами, что и для домов ГАР, и меряем ошибку. Возвращает статистику по способам."""
    import random
    rnd = random.Random(seed)
    cand = []
    for s in streets:
        if eval_split(s) != "train":
            continue                      # подбор параметров — только на train-части замера (val/test не трогаем)
        hs = [h for h in s.osm_house_by_norm.values() if h.precision == "house"]
        if len(hs) < 3:
            continue
        for h in hs:
            if h.norm.isdigit():
                cand.append((s, h))
    rnd.shuffle(cand)
    errs = collections.defaultdict(list)
    miss = 0
    for s, h in cand[:sample]:
        others = [x for x in s.osm_house_by_norm.values() if x.precision == "house" and x.base != h.base]
        e = NumberLine(others, s.zone is not None).estimate(h.norm)
        if e is None:
            miss += 1
            e = LineModel(s, others).estimate(h.norm)
            if e is not None:
                errs[e[2]].append(dist((e[0], e[1]), (h.x, h.y)))
                errs[e[2] + "_vs_street_point"].append(dist((s.x, s.y), (h.x, h.y)))
            continue
        errs[e[2]].append(dist((e[0], e[1]), (h.x, h.y)))
    # номера с хвостом («21к2», «21/3», «21а»): прячем один, соседи той же целой части остаются
    suf = []
    for s in streets:
        if eval_split(s) != "train":
            continue
        hs = [h for h in s.osm_house_by_norm.values() if h.precision == "house"]
        bases = collections.Counter(h.base for h in hs)
        suf += [(s, h) for h in hs if h.base is not None and bases[h.base] > 1]
    rnd.shuffle(suf)
    for s, h in suf[:sample // 2]:
        others = [x for x in s.osm_house_by_norm.values() if x.precision == "house" and x is not h]
        nl = NumberLine(others, s.zone is not None)
        e = nl.estimate(h.norm)
        if e is not None:
            kind = "same_base_plain" if h.norm.isdigit() else "same_base_suffix"
            errs[kind].append(dist((e[0], e[1]), (h.x, h.y)))
            if kind == "same_base_suffix":
                errs["same_base_suffix_anchor_only"].append(dist(nl.point(h.base), (h.x, h.y)))
    out = {"sample": min(sample, len(cand)), "streets": "train", "no_estimate": miss}
    for k, v in errs.items():
        v.sort()
        out[k] = dict(n=len(v), median_m=round(v[len(v) // 2], 1), p90_m=round(v[int(len(v) * 0.9)], 1),
                      share_le_50m=round(sum(1 for x in v if x <= 50) / len(v), 3))
    return out


def match_gar(P, streets, houses, gar_objs, gar_houses, bare, stats):
    """ГАР → индекс: пункты, СНТ, улицы, дома. Возвращает новые дома и улицы."""
    # --- пункты ГАР → наши пункты (имя + пересечение ключей улиц)
    streets_by_place = collections.defaultdict(list)
    for s in streets:
        if s.settlement is not None:
            streets_by_place[s.settlement.id].append(s)
    keys_by_place = {pid: {s.key for s in ss} for pid, ss in streets_by_place.items()}
    gar_streets = [o for o in gar_objs.values() if o["level"] == 8]
    gar_keys_by_settle = collections.defaultdict(set)
    for o in gar_streets:
        gar_keys_by_settle[o["settlement"]].add(tn.street_key(o["type"] + " " + o["name"]))
    set_by_key = collections.defaultdict(list)
    for s in P.settlements:
        set_by_key[s.key].append(s)
    settle_map = {}
    gar_settle_names = collections.Counter(tn.place_key(o["name"]) for o in gar_objs.values()
                                           if o["level"] in (5, 6) and not is_gar_snt(o))
    for oid, o in gar_objs.items():
        if o["level"] not in (5, 6) or is_gar_snt(o):
            continue
        cands = set_by_key.get(tn.place_key(o["name"]), [])
        if not cands:
            continue
        gk = gar_keys_by_settle.get(oid, set())
        scored = sorted(((len(gk & keys_by_place.get(c.id, set())), c) for c in cands), key=lambda t: -t[0])
        # имя единственное и в ГАР, и в OSM — берём, даже если улиц пункта в OSM не нашлось (хутор Воликов —
        # узел без контура, его дома в OSM приписаны соседнему пункту)
        unique = len(cands) == 1 and gar_settle_names[tn.place_key(o["name"])] == 1
        if scored[0][0] > 0 or (len(cands) == 1 and not gk) or unique:
            best = scored[0][1]
            if best.id in {p.id for p in settle_map.values()} and scored[0][0] == 0:
                continue
            settle_map[oid] = best
            best._gar_root = o["root"]
            if not best.gar:
                best.gar = o["guid"]
                best.source = "osm+gar"
            tname = tn.SETTLEMENT_TYPES.get(o["type"].lower().rstrip("."), None)
            if tname:
                best.add_alias(f"{tname} {o['name']}")
                best.add_alias(f"{o['type']} {o['name']}")
    # пункт ГАР, которого нет в OSM под своим именем («п. отделения № 2 СКЗНИИСиВ» — в OSM «Водники»): пункт OSM,
    # не занятый ни одним пунктом ГАР, с большинством его улиц. Имя ГАР — синоним.
    taken_p = {p.id for p in settle_map.values()}
    by_name = 0
    for oid, o in gar_objs.items():
        if o["level"] not in (5, 6) or is_gar_snt(o) or oid in settle_map:
            continue
        gk = gar_keys_by_settle.get(oid, set())
        if len(gk) < 3:
            continue
        best = max(((len(gk & keys_by_place.get(c.id, set())), c) for c in P.settlements if c.id not in taken_p),
                   key=lambda t: t[0], default=None)
        # и с обеих сторон: ≥50 % улиц ГАР и ≥30 % улиц пункта OSM (обычные имена «Школьная», «Лесная» есть в любом
        # большом пункте — Горячий Ключ не «с. Шабановское»)
        if best is None or best[0] < 3 or best[0] < 0.5 * len(gk) or \
                best[0] < 0.3 * len(keys_by_place.get(best[1].id, set())):
            continue
        c = best[1]
        settle_map[oid] = c
        taken_p.add(c.id)
        c._gar_root = o["root"]
        c.gar, c.source = o["guid"], "osm+gar"
        tname = tn.SETTLEMENT_TYPES.get(o["type"].lower().rstrip("."), None)
        if tname:
            c.add_alias(f"{tname} {o['name']}")
        c.add_alias(f"{o['type']} {o['name']}")
        by_name += 1
    stats["gar_settlements_by_streets"] = by_name
    stats["gar_settlements_matched"] = len(settle_map)
    # пункты ГАР без пары в OSM (край вырезки, нет place=* в OSM): сколько домов ГАР за ними
    hs_by_settle = collections.Counter(int(r["settlement"] or 0) for r in gar_houses)
    miss = [(hs_by_settle[oid], f"{o['type']} {o['name']}") for oid, o in gar_objs.items()
            if o["level"] in (5, 6) and not is_gar_snt(o) and oid not in settle_map and hs_by_settle[oid]]
    miss.sort(reverse=True)
    stats["gar_settlements_unmatched"] = dict(count=len(miss), houses=sum(n for n, _ in miss),
                                              top=[f"{name}: {n}" for n, name in miss[:15]])
    # пункт → «под-места»: пункты и СНТ внутри его полигона (хутор внутри Краснодара, СНТ станицы)
    sub = collections.defaultdict(set)
    for p in list(P.settlements) + list(P.snts):
        for s in P.settlements:
            if s is not p and s.poly is not None and s.poly.contains(Point(p.x, p.y)):
                sub[s.id].add(p.id)
    for p in P.snts:
        if p.settlement is not None:
            sub[p.settlement.id].add(p.id)

    # --- СНТ и микрорайоны ГАР (уровень 7) → наши места
    snt_by_key = collections.defaultdict(list)
    for p in P.snts:
        snt_by_key[p.key].append(p)
        for a in p.aliases:
            snt_by_key[tn.snt_key(a)].append(p)
    micro_by_key = collections.defaultdict(list)
    for p in P.micro:
        micro_by_key[p.key].append(p)
        for a in p.aliases:
            micro_by_key[tn.place_key(a)].append(p)
    plan_map = {}
    new_plans = {}
    plan_street_keys = collections.defaultdict(set)
    for o in gar_streets:
        if o["plan"]:
            plan_street_keys[o["plan"]].add(tn.street_key(o["type"] + " " + o["name"]))
    zone_street_keys = collections.defaultdict(set)
    for s_ in streets:
        if s_.zone is not None:
            zone_street_keys[s_.zone.id].add(s_.key)
    for oid, o in gar_objs.items():
        if o["level"] != 7 and not (o["level"] == 6 and is_gar_snt(o)):
            continue
        sett = settle_map.get(o["settlement"])
        snt = is_gar_snt(o)
        if snt:
            k = tn.snt_key(o["name"])
            cands = snt_by_key.get(k, [])
        elif o["type"] in GAR_MICRO_TYPES:
            k = tn.place_key(o["name"])
            cands = micro_by_key.get(k, [])
        else:
            continue
        # одноимённые СНТ («Мечта», «Дружба»): больше общих улиц, затем внутри пункта, затем ближе
        best = None
        gk = plan_street_keys.get(oid, set())
        for c in cands:
            if sett is None:
                d = 0
            else:
                d = dist((c.x, c.y), (sett.x, sett.y))
                if c.settlement is sett or c.id in sub.get(sett.id, ()):
                    d = 0
            lim = 25000 if sett is not None and sett.kind == "city" else 12000
            score = (-len(gk & zone_street_keys.get(c.id, set())), d)
            if d < lim and (best is None or score < best[0]):
                best = (score, c)
        if best:
            plan_map[oid] = best[1]
            p = best[1]
            if not p.gar:
                p.gar = o["guid"]
                p.source = "osm+gar"
            p.add_alias(f"{o['type']} {o['name']}")
        elif sett is not None:
            # нет в OSM: место без контура, центр — по найденным домам (ниже); пока — центр пункта
            kind = "snt" if snt else "microdistrict"
            twin = next((q for q in new_plans.values() if q.settlement is sett and q.kind == kind and q.key == k), None)
            if twin is not None:
                # ГАР знает два одноимённых СНТ в одном пункте (без точки их не различить) — одно место
                plan_map[oid] = twin
                twin.add_alias(f"{o['type']} {o['name']}")
                continue
            name = f"СНТ {tn.snt_core(o['name'])}" if snt else f"{tn.SETTLEMENT_TYPES.get(o['type'].rstrip('.'), '')} {o['name']}".strip()
            pl = Place(sid("p", "gar:" + o["guid"]), kind, name, sett.x, sett.y, None, source="gar", gar=o["guid"])
            pl.key = k
            pl.settlement = sett
            pl.parent = sett.id
            pl.add_alias(f"{o['type']} {o['name']}")
            pl._gar_only = True
            new_plans[oid] = pl
            plan_map[oid] = pl
    stats["gar_plans_matched"] = len(plan_map) - len(new_plans)
    stats["gar_plans_new"] = len(new_plans)

    # --- дома ГАР по улицам
    gh_by_street = collections.defaultdict(list)
    gh_by_plan = collections.defaultdict(list)
    skipped = collections.Counter()
    for r in gar_houses:
        if r["housetype"] in GAR_SKIP_HOUSETYPES:
            skipped["тип"] += 1
            continue
        num = tn.gar_number(r["housenum"], r["addtype1"], r["addnum1"], r["addtype2"], r["addnum2"])
        norm = tn.number_norm(num)
        if not valid_norm(norm):
            skipped["номер"] += 1
            continue
        r["_num"], r["_norm"] = tn.number_display(num), norm
        st = int(r["street"] or 0)
        pl = int(r["plan"] or 0)
        if st:
            gh_by_street[st].append(r)
        elif pl:
            gh_by_plan[pl].append(r)
        else:
            skipped["без улицы и СНТ"] += 1
    stats["gar_skipped"] = dict(skipped)

    # --- улицы ГАР → наши улицы
    by_place_key = collections.defaultdict(list)
    for s in streets:
        by_place_key[(s.settlement.id if s.settlement else None, s.key)].append(s)
    # типы одноимённых улиц ГАР в пункте: «ул. Каляева» и «проезд Каляева» — разные улицы, тип решает
    gar_types = collections.defaultdict(set)
    for o in gar_streets:
        full = f"{o['type']} {o['name']}"
        gar_types[(o["settlement"], tn.street_key(full))].add(tn.effective_type(full))

    def type_ok(s, gtyp, settle):
        """Улица OSM подходит улице ГАР по типу: тот же тип, без типа, или другого типа, но такого типа
        у одноимённых улиц ГАР этого пункта нет (разночтение источников: «пр-кт» в ГАР, «улица» в OSM)."""
        return not s.typ or not gtyp or s.typ == gtyp or s.typ not in gar_types[(settle, s.key)]

    streets_by_core = collections.defaultdict(list)
    for s in streets:
        streets_by_core[tn.street_key_core(s.key)].append(s)
    neighbor_hits = ending_hits = 0
    street_map = {}
    new_streets = []
    type_skips = 0
    fuzzy_hits = 0
    one_letter_hits = 0
    subset_hits = 0
    pending = []
    unmatched = collections.Counter()
    lost = []
    # одноимённые улицы ГАР одного пункта («ул. Калинина» центра и Пашковского, «ул. Весёлая» двух СНТ) ↔ одноимённые
    # улицы OSM: один к одному — сначала совпадение СНТ/массива, затем больше общих номеров. Иначе обе улицы ГАР
    # садятся на самую большую улицу OSM, и дома второй встают на чужую нумерацию.
    pref = {}
    same_grp = collections.defaultdict(list)
    for o in gar_streets:
        sett = settle_map.get(o["settlement"])
        if sett is not None:
            full = f"{o['type']} {o['name']}"
            same_grp[(sett.id, tn.street_key(full), tn.effective_type(full))].append(o)
    for (sett_id, key, gtyp), os_ in same_grp.items():
        if len(os_) < 2:
            continue
        places = {sett_id} | sub.get(sett_id, set())
        cands = [s for pid in places for s in by_place_key.get((pid, key), []) if not s.typ or s.typ == gtyp]
        if len(cands) < 2:
            continue
        pairs = []
        for o in os_:
            gn = {r["_norm"] for r in gh_by_street.get(o["objectid"], [])}
            if not gn:
                continue                   # улица ГАР без домов — делить нечего
            plan = plan_map.get(o["plan"]) if o["plan"] else None
            for s in cands:
                ov = len(gn & set(s.osm_house_by_norm))
                # СНТ/массив: улица OSM лежит в этом СНТ (сильный признак — нумерации СНТ «1…N» номерами не различить);
                # рядом с его контуром (≤300 м) — только при равенстве номеров
                in_plan = plan is not None and s.place is plan
                near_plan = plan is not None and plan.poly is not None and plan.poly.distance(Point(s.x, s.y)) < 300
                # без общих номеров — только своё СНТ и улица OSM без домов (одна линия)
                if ov >= 2 or ((in_plan or near_plan) and (ov >= 1 or not s.osm_house_by_norm)):
                    pairs.append((in_plan, ov, near_plan, o["objectid"], id(s), s))
        pairs.sort(key=lambda t: (t[0], t[1], t[2]), reverse=True)
        used_s = set()
        for _, _, _, oid, sk, s in pairs:
            if oid in pref or sk in used_s:
                continue
            pref[oid] = s
            used_s.add(sk)
    stats["gar_streets_same_name_one_to_one"] = len(pref)
    # номера домов улиц ГАР по (наш пункт, ключ): улицу OSM, которую своя одноимённая улица ГАР её пункта объясняет не
    # хуже, соседнему пункту не отдаём («ул. Веселая» х. Октябрьский ≠ «улица Весёлая» п. Южный — 11 общих мелких номеров)
    own_gar_nums = collections.defaultdict(set)
    for (sett_id, key, _), os_ in same_grp.items():
        for o in os_:
            own_gar_nums[(sett_id, key)] |= {r["_norm"] for r in gh_by_street.get(o["objectid"], [])}
    taken_by_pref = {id(s) for s in pref.values()}
    multi_oids = {o["objectid"] for os_ in same_grp.values() if len(os_) > 1 for o in os_}
    for o in gar_streets:
        sett = settle_map.get(o["settlement"])
        if sett is None:
            unmatched["пункт не найден"] += 1
            continue
        plan = plan_map.get(o["plan"]) if o["plan"] else None
        full = f"{o['type']} {o['name']}"
        key = tn.street_key(full)
        gtyp = tn.effective_type(full)
        places = {sett.id} | sub.get(sett.id, set())
        cands = [s for pid in places for s in by_place_key.get((pid, key), [])]
        if o["objectid"] in pref:
            cands = [pref[o["objectid"]]]
        elif o["objectid"] in multi_oids:
            # одноимённая улица ГАР без своей пары в OSM не садится на улицу, занятую другой одноимённой, на улицу
            # в чужом СНТ и на улицу с домами OSM без единого общего номера (другая улица с тем же именем)
            gn0 = {r["_norm"] for r in gh_by_street.get(o["objectid"], [])}
            cands = [s for s in cands if id(s) not in taken_by_pref
                     and not (plan is not None and s.zone is not None and s.zone is not plan)
                     and not (gn0 and len(s.osm_house_by_norm) >= 3 and not gn0 & set(s.osm_house_by_norm))]
        if o["objectid"] not in pref and cands:
            same = [s for s in cands if s.typ == gtyp]
            c2 = same or [s for s in cands if type_ok(s, gtyp, o["settlement"])]
            if len(c2) < len(cands) and not same:
                type_skips += 1
            cands = c2
        # одноимённые в разных СНТ — по СНТ ГАР, без СНТ — не-СНТ улицы
        if len(cands) > 1:
            if plan is not None:
                c2 = [s for s in cands if s.place is plan]
                if not c2 and plan.poly is not None:
                    c2 = [s for s in cands if plan.poly.distance(Point(s.x, s.y)) < 300]
                cands = c2 or cands
            else:
                c2 = [s for s in cands if s.zone is None]
                cands = c2 or cands
        gnums = {r["_norm"] for r in gh_by_street.get(o["objectid"], [])}
        if len(cands) > 1:
            scored = sorted(cands, key=lambda s: (-len(gnums & set(s.osm_house_by_norm)), -len(s.osm_house_by_norm)))
            cands = scored[:1]
        if not cands:
            # имя с именем/инициалами и без: «ул. им. Дмитрия Благоева» = «улица Благоева», «К.Маркса» = «Карла Маркса»
            # и без званий: «ул. им. Героя Советского Союза Иванова» = «улица Генерала Иванова»
            kt = set(tn.street_key_core(key).split())
            pool = [s for pid in places for s in streets_by_place.get(pid, [])]
            sub_c = []
            for s in pool:
                if not type_ok(s, gtyp, o["settlement"]):
                    continue
                st_ = set(tn.street_key_core(s.key).split())
                common = kt & st_
                if not common or not any(len(w) >= 4 for w in common) or s.key == key:
                    continue
                if (st_ <= kt or kt <= st_) and all(len(w) >= 2 for w in kt ^ st_):
                    sub_c.append(s)
            if sub_c:
                if plan is None:
                    sub_c = [s for s in sub_c if s.zone is None] or sub_c
                sub_c.sort(key=lambda s: (-len(gnums & set(s.osm_house_by_norm)), -len(s.osm_house_by_norm)))
                if len(sub_c) == 1 or len(gnums & set(sub_c[0].osm_house_by_norm)) > 0:
                    cands = sub_c[:1]
                    subset_hits += 1
        if not cands:
            # фамилия в разных падежах/написаниях: «ул. им. Шпак» = «улица Шпака», «ул. Чуц» = «улица Чуца»
            pool = [s for pid in places for s in streets_by_place.get(pid, [])]
            alt = [s for s in pool if type_ok(s, gtyp, o["settlement"]) and len(key) >= 3 and
                   (s.key == key + "а" or key == s.key + "а")]
            if len(alt) == 1:
                ov = len(gnums & set(alt[0].osm_house_by_norm))
                if ov > 0 or not gnums:
                    cands = alt
                    ending_hits += 1
        if not cands and fuzz is not None and len(key) >= 5:
            pool = [s for pid in places for s in streets_by_place.get(pid, [])] if places else []
            best = None
            for s in pool:
                if abs(len(s.key) - len(key)) > 3 or not type_ok(s, gtyp, o["settlement"]) or \
                        not same_digits(s.key, key):
                    continue
                r = fuzz.ratio(s.key, key)
                if r >= 90 and (best is None or r > best[0]):
                    best = (r, s)
            if best:
                ov = len(gnums & set(best[1].osm_house_by_norm))
                if ov > 0 or not gnums:
                    cands = [best[1]]
                    fuzzy_hits += 1
        if not cands and gnums and len(key) >= 6:
            # одна буква разницы — разночтение источников: «ул. им. Фелицына Е.Д.» = «улица Фелицина»,
            # «пр-д Деповской» = «Деповский проезд». Только улица OSM без своей улицы ГАР и с общими номерами (≥2)
            pool = [s for pid in places for s in streets_by_place.get(pid, [])]
            one = [s for s in pool if s.gar is None and s.source != "gar" and type_ok(s, gtyp, o["settlement"])
                   and spelling_variant(s.key, key) and len(gnums & set(s.osm_house_by_norm)) >= 2]
            if len(one) == 1:
                cands = one
                one_letter_hits += 1
        if not cands and gnums:
            # граница пунктов в ГАР и OSM расходится: улица ГАР «г. Краснодар» в OSM лежит в Елизаветинской,
            # «Чибийская» Энема — в соседнем пункте. Та же улица соседнего пункта (≤5 км от контура / ≤12 км от
            # центра), если совпадает много номеров домов.
            best = None
            for s in streets_by_core.get(tn.street_key_core(key), []):
                if s.settlement is None or s.settlement.id in places or not type_ok(s, gtyp, o["settlement"]):
                    continue
                pt = Point(s.x, s.y)
                near = sett.poly.distance(pt) <= 5000 if sett.poly is not None else dist((s.x, s.y), (sett.x, sett.y)) <= 12000
                if not near:
                    continue
                ov = len(gnums & set(s.osm_house_by_norm))
                own = own_gar_nums.get((s.settlement.id, s.key))
                if own is not None and len(own & set(s.osm_house_by_norm)) >= ov:
                    continue                 # у улицы своя одноимённая улица ГАР в её пункте
                enough = (ov >= 3 and ov >= 0.2 * min(len(gnums), len(s.osm_house_by_norm))) or (
                    ov >= 1 and ov >= 0.5 * len(s.osm_house_by_norm))
                if enough and (best is None or ov > best[0]):
                    best = (ov, s)
            if best:
                cands = [best[1]]
                neighbor_hits += 1
        if cands:
            s = cands[0]
            street_map[o["objectid"]] = s
            if s.gar is None:
                s.gar = o["guid"]
                s.source = "osm+gar"
                s.variants[("gar", full)] += 0
                s._gar_name = full
                s._gar_type = tn.split_street(full)[1]
            else:
                s.aliases.append(tn.canonical_street(tn.pretty_core(tn.split_street(full)[0]), tn.split_street(full)[1]))
            continue
        pending.append((o, sett, plan, key, full))

    # центры СНТ/микрорайонов, которых нет в OSM, — медиана точек их улиц, найденных в OSM;
    # таких улиц нет — места без точки не берём (иначе дома СНТ встали бы в центр города)
    pts_by_plan = collections.defaultdict(list)          # id места → точки его улиц (и улиц одноимённого двойника)
    new_ids = {pl.id for pl in new_plans.values()}
    for o in gar_streets:
        s = street_map.get(o["objectid"])
        pl = plan_map.get(o["plan"]) if o["plan"] else None
        if s is not None and pl is not None and pl.id in new_ids:
            pts_by_plan[pl.id].append((s.x, s.y))
    for oid, pl in list(new_plans.items()):
        pts = pts_by_plan.get(pl.id)
        st_ = pl.settlement
        if pts:
            pl.x = sorted(p[0] for p in pts)[len(pts) // 2]
            pl.y = sorted(p[1] for p in pts)[len(pts) // 2]
        elif st_ is not None and (st_.kind in ("village", "hamlet") or (
                st_.poly is not None and math.sqrt(st_.poly.area) < 3000)):
            # СНТ небольшого пункта без своей точки — точка пункта, дома честно «≈» (place), как улицы только из ГАР
            pl.x, pl.y = st_.x, st_.y
            unmatched["СНТ/микрорайон ГАР — точка небольшого пункта"] += 1
        else:
            del new_plans[oid]
            for k_ in [k_ for k_, v_ in plan_map.items() if v_ is pl]:
                del plan_map[k_]
            unmatched["СНТ/микрорайон ГАР без точки"] += 1

    stats["gar_plans_new"] = len(new_plans)
    for o, sett, plan, key, full in pending:
        # улица только в ГАР: точка — место (СНТ или небольшой пункт), иначе не берём
        plan = plan_map.get(o["plan"]) if o["plan"] else None
        if o["plan"] and plan is None and o["plan"] in gar_objs and (
                is_gar_snt(gar_objs[o["plan"]]) or gar_objs[o["plan"]]["type"] in GAR_MICRO_TYPES):
            unmatched["улица в СНТ без точки"] += 1
            lost.append((len(gh_by_street.get(o["objectid"], [])), sett.name, full))
            continue
        home = plan or sett
        small = home.kind in ("snt", "village", "hamlet") or (
            home.poly is not None and math.sqrt(home.poly.area) < 3000)
        if home.kind == "microdistrict":
            # новый квартал крупного пункта («мкр. …», «кв-л …» ГАР): точка — квартал, если он компактный
            # (контур OSM до ~3×3 км) или его центр посчитан по его же улицам; дома честно «≈» (place)
            small = (home.poly is not None and math.sqrt(home.poly.area) < 3000) or getattr(home, "_gar_only", False)
            if small:
                unmatched["улица ГАР у квартала (точка квартала)"] += 1
        if not small:
            unmatched["улица без точки в крупном пункте"] += 1
            lost.append((len(gh_by_street.get(o["objectid"], [])), sett.name, full))
            continue
        if not gh_by_street.get(o["objectid"]):
            unmatched["улица ГАР без домов"] += 1
            continue
        s = Street()
        s.key = key
        s.settlement = sett
        s.zone = plan if plan is not None and plan.kind == "snt" else None
        s.place = home
        s.source = "gar"
        s.gar = o["guid"]
        s.typ = tn.effective_type(full)
        s.variants[("gar", full)] += 1
        s._gar_name = full
        s._gar_type = tn.split_street(full)[1]
        s.x, s.y = home.x, home.y
        s.id = sid("s", "gar:" + o["guid"])
        new_streets.append(s)
        street_map[o["objectid"]] = s
    stats["gar_streets_total"] = len(gar_streets)
    stats["gar_streets_matched"] = len(street_map) - len(new_streets)
    stats["gar_streets_fuzzy"] = fuzzy_hits
    stats["gar_streets_one_letter"] = one_letter_hits
    stats["gar_streets_type_filtered"] = type_skips
    stats["gar_streets_in_neighbor_settlement"] = neighbor_hits
    stats["gar_streets_by_ending"] = ending_hits
    stats["gar_streets_by_name_subset"] = subset_hits
    stats["gar_streets_new"] = len(new_streets)
    stats["gar_streets_unmatched"] = dict(unmatched)
    lost.sort(reverse=True)
    stats["gar_streets_lost_houses"] = sum(n for n, _, _ in lost)
    stats["gar_streets_lost_top"] = [f"{c}: {n} ({k})" for k, c, n in lost[:40]]
    log("улицы ГАР:", stats["gar_streets_matched"], "совпали,", len(new_streets), "новых,", dict(unmatched))

    # --- здания без адреса (для «примагничивания» интерполяции)
    bare_pts = [to_m(b["lon"], b["lat"]) for b in bare if b["area"] >= 30]
    bare_tree = STRtree(shapely.points(bare_pts)) if bare_pts else None

    new_houses = []
    street_why = collections.Counter()
    # здание без адреса, на которое уже сел адресный узел OSM (snap_nodes), занято: второй номер на него не сажаем
    bare_used = set()
    if bare_tree is not None and houses:
        ii, jj = bare_tree.query(shapely.points([(h.x, h.y) for h in houses]), predicate="dwithin", distance=1.0)
        bare_used.update(jj.tolist())
    prec = collections.Counter()
    methods = collections.Counter()
    merged = 0
    for oid, rows in gh_by_street.items():
        s = street_map.get(oid)
        if s is None:
            continue
        known = s.osm_house_by_norm
        pos = make_pos(set(known) | {r["_norm"] for r in rows})
        est = NumberLine([h for h in known.values() if h.precision == "house"], s.zone is not None, pos)
        lm = None
        seen = set()
        rows.sort(key=lambda r: r["kind"] != "house")     # дома раньше участков
        for r in rows:
            norm = r["_norm"]
            if norm in seen:
                continue
            seen.add(norm)
            h = known.get(norm)
            if h is not None:
                if h.gar is None:
                    h.gar = r["guid"]
                    h.source = "osm+gar"
                    merged += 1
                if not h.postcode and r.get("postcode"):
                    h.postcode = r["postcode"]
                continue
            x = y = None
            p = "street"
            b = tn.number_base(norm)
            if s.source == "gar":
                x, y, p = s.x, s.y, s.gar_precision
            elif b is not None:
                e = est.estimate(norm)
                if e is not None:
                    x, y, method, shared = e
                    # «interpolated» — только способы, которые по проверке «исключи один» укладываются в критерий
                    # (медиана ≤10 м, 90% ≤40 м): соседи той же стороны и подряд в СНТ. Остальное — честное «≈»
                    # (street) с лучшей точкой, что есть: та же целая часть номера (медиана ~20 м), за краем (~14 м,
                    # но 90% — ~80 м)
                    p = "interpolated" if method in INTERPOLATED_METHODS else "street"
                    if p == "interpolated" and b in pos.crowded and norm != str(b):
                        p = "street"          # номер комплекса («8/39» из 230 «8/…»): точка у въезда, честно «≈»
                        methods["crowded_complex"] += 1
                    methods[method] += 1
                    if shared:
                        methods["shared_point"] += 1
                    if method != "same_base" and bare_tree is not None:
                        # здание без адреса одно в 20 м и ещё не занято другим номером — точка дома
                        near = [j for j in bare_tree.query(Point(x, y), predicate="dwithin", distance=20).tolist()]
                        if len(near) == 1 and near[0] not in bare_used:
                            bare_used.add(near[0])
                            x, y = bare_pts[near[0]]
                            methods["snapped_to_building"] += 1
            if x is None and b is not None and s.source != "gar" and s.lines:
                # соседей той же чётности ближе 150 м нет — вдоль линии улицы по дальним соседям той же стороны.
                # Точность «≈» (медиана ~25 м против ~250 м у точки улицы), поэтому precision остаётся street.
                if lm is None:
                    lm = LineModel(s, [h for h in known.values() if h.precision == "house"], pos)
                e = lm.estimate(norm)
                if e is not None:
                    x, y = e[0], e[1]
                    methods[e[2]] += 1
            if x is None:
                x, y = s.x, s.y
                if s.source != "gar":
                    nk = len(est.fines)
                    why = ("нет домов OSM на улице" if nk == 0 else "один дом OSM" if nk == 1 else
                           "нет соседей той же чётности рядом")
                    top = s.settlement.name if s.settlement is not None else "-"
                    street_why[(top if top == P.city.name else "другие", why, bool(s.lines))] += 1
            hh = House(s, s.place, r["_num"], norm, x, y, p, "gar", r.get("postcode") or None, None, r["guid"])
            new_houses.append(hh)
            prec[p] += 1
    # дома ГАР только с СНТ/микрорайоном (без улицы): точка места
    for oid, rows in gh_by_plan.items():
        pl = plan_map.get(oid)
        if pl is None:
            continue
        seen = set()
        for r in sorted(rows, key=lambda r: r["kind"] != "house"):
            if r["_norm"] in seen:
                continue
            seen.add(r["_norm"])
            new_houses.append(House(None, pl, r["_num"], r["_norm"], pl.x, pl.y, "place", "gar",
                                    r.get("postcode") or None, None, r["guid"]))
            prec["place"] += 1
    stats["gar_houses_merged_with_osm"] = merged
    # доля адресов ГАР (улица или СНТ + номер; дома и участки, без гаражей), попавших в индекс
    want, lost_by = set(), collections.Counter()
    for oid, rows in gh_by_street.items():
        for r in rows:
            want.add(("s", oid, r["_norm"]))
    for oid, rows in gh_by_plan.items():
        for r in rows:
            want.add(("p", oid, r["_norm"]))
    got = {k for k in want if (k[0] == "s" and k[1] in street_map) or (k[0] == "p" and k[1] in plan_map)}
    for k in want - got:
        if k[0] == "s":
            o = gar_objs.get(k[1])
            lost_by["пункт ГАР не найден в OSM" if o is None or o["settlement"] not in settle_map else
                    "улица ГАР не найдена / без точки"] += 1
        else:
            lost_by["СНТ/квартал ГАР без точки"] += 1
    stats["gar_addresses_in_index"] = dict(total=len(want), in_index=len(got),
                                           share=round(len(got) / max(1, len(want)), 4), lost=dict(lost_by),
                                           skipped_before=dict(skipped))
    stats["gar_interpolation_methods"] = dict(methods)
    stats["gar_street_precision_reasons"] = {f"{a} / {b} / {'есть линия' if c else 'нет линии'}": n
                                             for (a, b, c), n in street_why.most_common()}
    stats["gar_houses_new_by_precision"] = dict(prec)
    log("дома ГАР: совпали с OSM", merged, "новые", dict(prec))
    return new_streets, new_houses, list(new_plans.values())


# ---------------------------------------------------------------- 5б. иерархия мест и граница индекса

# bbox агломерации (как у карты OSRM). Вырезка OSM шире (osm_extract.BBOX); в индекс из-за его края входят
# только пункты районов ГАР (найденные в ГАР) и то, что внутри этого bbox.
CORE_BBOX = tuple(float(x) for x in os.environ.get("GEOCODER_CORE_BBOX", "38.60,44.85,39.45,45.30").split(","))


def in_core(x, y):
    lon, lat = to_ll(x, y)
    return CORE_BBOX[0] <= lon <= CORE_BBOX[2] and CORE_BBOX[1] <= lat <= CORE_BBOX[3]


def assign_parents(P, osm, gar_objs):
    """Посёлки, хутора и СНТ в черте города (Лазурный, Российский, Старокорсунская…) → родитель — город.
    Черта — граница городского округа OSM (admin_level 6) или корень ГАР «г. Краснодар» у пункта."""
    city = P.city
    polys = [geom_m(a["wkb"]) for a in osm["admin"] if a["level"] == "6" and city.key
             and city.key in tn.place_key(a["name"]).split()]
    poly = shapely.union_all(polys) if polys else None
    roots = {o["root"] for o in (gar_objs or {}).values()
             if o["level"] == 5 and tn.place_key(o["name"]) == city.key}
    n = 0
    for p in list(P.settlements) + list(P.snts) + list(P.micro):
        if p is city or p.parent is not None:
            continue
        inside = poly is not None and poly.contains(Point(p.x, p.y))
        if inside or (roots and getattr(p, "_gar_root", None) in roots):
            p.parent = city.id
            n += 1
    return dict(city_boundary_from_osm=poly is not None, city_gar_roots=len(roots), parent_set_to_city=n)


def trim_to_area(P, streets, houses):
    """Отрезает то, что попало из-за широкой вырезки: пункты вне bbox агломерации без пары в ГАР (соседние
    районы) — вместе с их СНТ, микрорайонами, улицами и домами."""
    drop = set()
    for s in P.settlements:
        if s is P.city or in_core(s.x, s.y) or s.gar or s.parent == P.city.id:
            continue
        drop.add(s.id)
    for p in list(P.snts) + list(P.micro):
        st = p.settlement
        if (st is not None and st.id in drop) or (st is None and p.parent is None and not in_core(p.x, p.y)):
            drop.add(p.id)
    for pid in drop:
        del P.all[pid]
    P.settlements = [p for p in P.settlements if p.id not in drop]
    P.snts = [p for p in P.snts if p.id not in drop]
    P.micro = [p for p in P.micro if p.id not in drop]

    def keep_street(s):
        if s.place is not None and s.place.id in drop:
            return False
        if s.settlement is not None:
            return s.settlement.id not in drop
        return in_core(s.x, s.y)

    kept = [s for s in streets if keep_street(s)]
    ks = {id(s) for s in kept}
    kh = [h for h in houses if (h.street is not None and id(h.street) in ks) or
          (h.street is None and h.place is not None and h.place.id not in drop)]
    return kept, kh, dict(places_dropped=len(drop), streets_dropped=len(streets) - len(kept),
                          houses_dropped=len(houses) - len(kh))


# ---------------------------------------------------------------- 6. объекты

def build_pois(P, osm, houses, locate_settlement):
    items = []
    for p in osm["pois"]:
        items.append(dict(p))
    for r in osm["resid"]:
        if tn.residential_complex(r["name"]):
            items.append(dict(osm=r["osm"], kind="residential_complex", name=r["name"], alts=r["alts"],
                              lon=r["lon"], lat=r["lat"], area=r["area"], street=None, hn=None))
    for p in osm["places"]:
        if p["place"] in ("neighbourhood", "quarter", "suburb") and tn.residential_complex(p["name"]):
            items.append(dict(osm=p["osm"], kind="residential_complex", name=p["name"], alts=p["alts"],
                              lon=p["lon"], lat=p["lat"], area=0.0, street=None, hn=None))
    osm_h = [h for h in houses if h.precision == "house" and h.street is not None]
    tree = STRtree(shapely.points([(h.x, h.y) for h in osm_h]))
    out = []
    seen = []
    for it in sorted(items, key=lambda i: -i["area"]):
        name = tn.clean(it["name"])
        aliases = []
        rc = tn.residential_complex(name)
        if it["kind"] == "residential_complex":
            if not rc:
                rc = (f"ЖК {name}", name)
            name, core = rc
            aliases.append(core)
        elif it["kind"] == "mall":
            m = re.match(r"(?i)^(ТЦ|ТРЦ|ТРК|ТК|Торговый центр|Торгово-развлекательный центр)\s+(.+)$", name)
            if m:
                aliases.append(m.group(2))
            else:
                aliases.append(f"ТЦ {name}")
        for a in it["alts"]:
            a = tn.clean(a)
            if a and a != name:
                aliases.append(a)
        x, y = to_m(it["lon"], it["lat"])
        key = tn.low(name)
        if any(k == key and dist((x, y), (sx, sy)) < 500 for k, sx, sy in seen):
            continue
        seen.append((key, x, y))
        addr = None
        if it.get("street") and it.get("hn"):
            core, typ = tn.split_street(it["street"])
            addr = f"{tn.canonical_street(tn.pretty_core(core), typ)}, {tn.number_display(it['hn'])}"
        else:
            j = tree.query_nearest(Point(x, y), max_distance=40, return_distance=False)
            if len(j):
                h = osm_h[int(j[0])]
                addr = f"{h.street.name}, {h.number}"
        out.append(dict(id=sid("o", "osm:" + it["osm"]), name=name, kind=it["kind"],
                        aliases=list(dict.fromkeys(aliases))[:8], x=x, y=y, address=addr, osm=it["osm"]))
    st = locate_settlement([o["x"] for o in out], [o["y"] for o in out])
    for o, s in zip(out, st):
        o["place"] = s
    log("объектов", len(out), collections.Counter(o["kind"] for o in out))
    return out


# ---------------------------------------------------------------- 7. запись и отчёт

def finalize(P, streets, houses):
    """id, имена, точки улиц; число домов на улице; центры мест ГАР — по их домам."""
    for s in streets:
        if not getattr(s, "id", None):
            base = f"{s.settlement.id if s.settlement else '-'}|{s.key}"
            if s.gar:
                s.id = sid("s", "gar:" + s.gar)
            else:
                anchor = min((seg["osm"] for seg in s.lines), default=None) or min(
                    (d["a"]["osm"] for d in s.houses), default="")
                s.id = sid("s", base + "|" + anchor)
        name_street(s, getattr(s, "_gar_name", None), getattr(s, "_gar_type", None))
    ids = collections.Counter(s.id for s in streets)
    assert not [k for k, v in ids.items() if v > 1], "повтор id улиц"
    cnt = collections.Counter(id(h.street) for h in houses if h.street is not None)
    for s in streets:
        s.n_houses = cnt.get(id(s), 0)


def dedupe_houses(houses):
    """Один дом на (улица|место, номер): первый — OSM, затем ГАР (одна улица OSM бывает целью двух улиц ГАР)."""
    seen, out = set(), []
    for h in houses:
        k = (id(h.street) if h.street is not None else None, h.place.id if h.street is None and h.place else None,
             h.norm)
        if k in seen:
            continue
        seen.add(k)
        out.append(h)
    return out


LINE_SIMPLIFY_M = 3.0


def street_geometry(s):
    """Линия улицы для обратного геокодирования («ближайшая улица»): куски OSM склеены (linemerge), упрощены
    до ~3 м, координаты [lon, lat] с 6 знаками (≈0,1 м). Нет линии (улица только из домов или ГАР) — None."""
    if not s.lines:
        return None
    merged = linemerge(MultiLineString([seg["line"] for seg in s.lines]))
    parts = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
    out = []
    for g in parts:
        g = g.simplify(LINE_SIMPLIFY_M, preserve_topology=False)
        cs = [[round(x / KX + 39.0, 6), round(y / KY + 45.0, 6)] for x, y in g.coords]
        if len(cs) >= 2:
            out.append(cs)
    return out or None


def check_reverse(osm, streets, houses, sample=20000, seed=11):
    """Хватает ли точек для обратного геокодирования (точка → адрес). Точки проверки — здания без адреса
    (там люди нажимают «Определить моё местоположение»): расстояние до ближайшего дома с точкой здания или
    интерполяцией и до ближайшей линии улицы."""
    import random
    rnd = random.Random(seed)
    pts = [to_m(b["lon"], b["lat"]) for b in osm["bare"]]
    pts = [p for p in pts if in_core(*p)]
    rnd.shuffle(pts)
    pts = pts[:sample]
    good = [h for h in houses if h.precision in ("house", "interpolated")]
    htree = STRtree(shapely.points([(h.x, h.y) for h in good]))
    lines = [ln for s in streets for ln in (seg["line"] for seg in s.lines)]
    ltree = STRtree(lines)
    P_ = shapely.points(pts)
    _, dh = htree.query_nearest(P_, return_distance=True, all_matches=False)
    _, dl = ltree.query_nearest(P_, return_distance=True, all_matches=False)
    dh, dl = sorted(dh.tolist()), sorted(dl.tolist())

    def q(v, x):
        return round(v[min(len(v) - 1, int(len(v) * x))], 1)

    return dict(sample=len(pts), house_median_m=q(dh, 0.5), house_p90_m=q(dh, 0.9),
                house_share_le_50m=round(sum(1 for x in dh if x <= 50) / max(1, len(dh)), 3),
                street_line_median_m=q(dl, 0.5), street_line_p90_m=q(dl, 0.9),
                street_line_share_le_100m=round(sum(1 for x in dl if x <= 100) / max(1, len(dl)), 3))


def check_type_pairs(streets, houses):
    """Одноимённые улицы разных типов в одном пункте («улица Каляева» и «проезд Каляева»): сколько пар, у скольких
    совпадают номера домов (раньше их склеивали в одну улицу, и дом одной «уезжал» к дому другой)."""
    nums = collections.defaultdict(set)
    for h in houses:
        if h.street is not None:
            nums[id(h.street)].add(h.norm)
    groups = collections.defaultdict(list)
    for s in streets:
        groups[(s.settlement.id if s.settlement else None, s.key)].append(s)
    pairs = clash = 0
    ex = []
    for ss in groups.values():
        types = {s.typ for s in ss if s.typ}
        if len(types) < 2:
            continue
        for i in range(len(ss)):
            for j in range(i + 1, len(ss)):
                a, b = ss[i], ss[j]
                if not a.typ or not b.typ or a.typ == b.typ:
                    continue
                pairs += 1
                common = nums[id(a)] & nums[id(b)]
                if common:
                    clash += 1
                    ex.append((len(common), f"{a.name} / {b.name} ({a.settlement.name if a.settlement else '-'}): "
                                            f"общих номеров {len(common)}"))
    ex.sort(reverse=True)
    return dict(pairs=pairs, pairs_with_same_numbers=clash, top=[t for _, t in ex[:12]])


def check_osm_points(streets, houses):
    """Массовая проверка «точка дома = его объект OSM»: для каждого адресного объекта OSM (здание, узел) —
    расстояние от него до точки дома индекса с той же улицей и номером. Дальше 50 м остаются только настоящие
    копии адреса в OSM (два разных объекта с одной улицей и номером); выбирается копия среди соседних номеров."""
    by = {(id(h.street), h.norm): h for h in houses if h.street is not None}
    own = own_far = 0
    for h in houses:
        if h.source == "osm+gar" and h.street is not None:
            own += 1
    tot = tot_og = far = far_og = 0
    cat = collections.Counter()
    ex = []
    for s in streets:
        for d in s.houses:
            h = by.get((id(s), d["norm"]))
            if h is None:
                continue
            x, y = to_m(d["a"]["lon"], d["a"]["lat"])
            dd = dist((x, y), (h.x, h.y))
            og = h.source == "osm+gar"
            tot += 1
            tot_og += og
            if d["a"]["osm"] == h.osm and dd > 1 and not d.get("snapped"):   # узел, севший на здание, — не сдвиг
                own_far += 1
            if dd > 50:
                far += 1
                far_og += og
                sib = siblings_near(d, s.houses)
                cat["50–300 м (здание важнее точки, большее — меньшего)" if dd <= 300 else
                    ("дальше 300 м, у копии свои соседние номера" if sib >= 2 else "дальше 300 м, копия-одиночка")] += 1
                ex.append((round(dd), f"{s.name}, {d['number']} ({d['a']['osm']} → {h.osm}, соседей у копии {sib})"))
    ex.sort(reverse=True)
    return dict(osm_gar_houses=own, own_object_farther_16m=own_far,
                osm_objects=tot, farther_50m=far, share=round(far / max(1, tot), 5),
                osm_gar_objects=tot_og, osm_gar_farther_50m=far_og, osm_gar_share=round(far_og / max(1, tot_og), 5),
                categories=dict(cat),
                note="дальше 50 м — только копии адреса в OSM (другой объект с той же улицей и номером)",
                top=[f"{m} м: {t}" for m, t in ex[:15]])


def house_rows(houses):
    seen = set()
    rows = []
    for h in houses:
        owner = h.street.id if h.street is not None else ("p:" + h.place.id if h.place is not None else "-")
        hid = sid("h", owner + "|" + h.norm)
        if hid in seen:
            continue
        seen.add(hid)
        lon, lat = to_ll(h.x, h.y)
        rows.append((hid, h.street.id if h.street is not None else None, h.place.id if h.place is not None else None,
                     h.number[:40], h.norm[:40], round(lat, 7), round(lon, 7), h.precision, h.source,
                     h.postcode, h.osm, h.gar))
    return rows


def write_db(url, city_slug, version, P, streets, houses, pois, counts):
    import psycopg
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("select id from cities where slug = %s", (city_slug,))
            row = cur.fetchone()
            if not row:
                raise SystemExit(f"в БД нет города {city_slug} (сначала pnpm db:seed / db:sync-catalog)")
            city_id = row[0]
            now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)   # timestamp без зоны — UTC
            for t in ("geo_houses", "geo_pois", "geo_streets"):
                cur.execute(f"delete from {t} where city_id = %s", (city_id,))
            cur.execute("update geo_places set parent_id = null where city_id = %s", (city_id,))
            cur.execute("delete from geo_places where city_id = %s", (city_id,))
            order = {"city": 0, "town": 1, "village": 1, "hamlet": 1, "district": 2, "okrug": 2,
                     "microdistrict": 3, "snt": 3}
            places = sorted(P.all.values(), key=lambda p: order.get(p.kind, 9))
            with cur.copy("copy geo_places (id, city_id, kind, name, aliases, parent_id, lat, lon, bounds, source, "
                          "osm_ref, gar_guid, updated_at) from stdin") as cp:
                for p in places:
                    lon, lat = to_ll(p.x, p.y)
                    b = bounds_json(p.poly)
                    cp.write_row((p.id, city_id, p.kind, p.name[:160], p.aliases[:20],
                                  p.parent if p.parent in P.all else None, round(lat, 7), round(lon, 7),
                                  json.dumps(b) if b else None, p.source, p.osm, p.gar, now))
            with cur.copy("copy geo_streets (id, city_id, place_id, name, type, name_key, aliases, lat, lon, houses, "
                          "line, source, gar_guid, updated_at) from stdin") as cp:
                for s in streets:
                    lon, lat = to_ll(s.x, s.y)
                    geom = getattr(s, "geom", None)
                    cp.write_row((s.id, city_id, s.place.id if s.place is not None else None, s.name[:200],
                                  (s.type or "")[:30], s.key[:200], s.aliases, round(lat, 7), round(lon, 7),
                                  s.n_houses, json.dumps(geom, separators=(",", ":")) if geom else None,
                                  s.source, s.gar, now))
            with cur.copy("copy geo_houses (id, city_id, street_id, place_id, number, number_norm, lat, lon, "
                          "precision, source, postcode, osm_ref, gar_guid, updated_at) from stdin") as cp:
                for r in house_rows(houses):
                    cp.write_row((r[0], city_id) + r[1:] + (now,))
            with cur.copy("copy geo_pois (id, city_id, place_id, name, kind, aliases, lat, lon, address, source, "
                          "osm_ref, updated_at) from stdin") as cp:
                for o in pois:
                    lon, lat = to_ll(o["x"], o["y"])
                    cp.write_row((o["id"], city_id, o["place"].id if o["place"] is not None else None, o["name"][:200],
                                  o["kind"], o["aliases"], round(lat, 7), round(lon, 7),
                                  (o["address"] or None) and o["address"][:200], "osm", o["osm"], now))
            import secrets
            imp_id = "gi_" + now.strftime("%Y%m%d%H%M%S") + secrets.token_hex(3)
            cur.execute("insert into geo_imports (id, city_id, version, built_at, counts) values (%s, %s, %s, %s, %s)",
                        (imp_id, city_id, version, now, json.dumps(counts)))
        conn.commit()
    log("записано в БД:", counts)


def report(path, P, streets, houses, pois, stats, version):
    prec = collections.Counter(h.precision for h in houses)
    src = collections.Counter(h.source for h in houses)
    by_place = collections.defaultdict(collections.Counter)
    for h in houses:
        pl = h.place
        top = pl
        while top is not None and top.kind in ("snt", "microdistrict", "okrug") and top.settlement is not None:
            top = top.settlement
        by_place[top.name if top is not None else "(вне пунктов)"][h.precision] += 1
    kinds = collections.Counter(p.kind for p in P.all.values())
    lines = [f"## Отчёт сборки ({version})", "",
             f"Места: {sum(kinds.values())} — " + ", ".join(f"{k} {v}" for k, v in kinds.most_common()),
             f"Улицы: {len(streets)} (OSM {sum(1 for s in streets if s.source == 'osm')}, "
             f"OSM+ГАР {sum(1 for s in streets if s.source == 'osm+gar')}, только ГАР {sum(1 for s in streets if s.source == 'gar')})",
             f"Дома: {len(houses)}; объекты: {len(pois)}", "",
             "| Точность | Домов | Доля |", "|---|---:|---:|"]
    for k in ("house", "interpolated", "street", "place"):
        lines.append(f"| {k} | {prec[k]} | {prec[k] / max(1, len(houses)):.1%} |")
    st_own = sum(1 for h in houses if h.precision == "street" and h.street is not None
                 and dist((h.x, h.y), (h.street.x, h.street.y)) > 1)
    lines += ["", f"street: {st_own} домов со своей точкой по соседям (та же целая часть номера, за краем нумерации, "
              f"вдоль линии улицы), {prec['street'] - st_own} — в точке улицы."]
    lines += ["", "| Источник | Домов |", "|---|---:|"] + [f"| {k} | {v} |" for k, v in src.most_common()]
    lines += ["", "| Пункт | Всего | house | interpolated | street | place |", "|---|---:|---:|---:|---:|---:|"]
    for name, c in sorted(by_place.items(), key=lambda kv: -sum(kv[1].values()))[:40]:
        lines.append(f"| {name} | {sum(c.values())} | {c['house']} | {c['interpolated']} | {c['street']} | {c['place']} |")
    lines += ["", "Статистика шагов:", "", "```", json.dumps(stats, ensure_ascii=False, indent=1), "```", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    log("отчёт:", path)


# ---------------------------------------------------------------- проверки

def selftest():
    """Проверки чистых функций сборки на игрушечных данных (без OSM/ГАР)."""
    ok = True

    def check(cond, msg):
        nonlocal ok
        if not cond:
            print("FAIL:", msg)
            ok = False

    def H(n, x, y=0.0):
        return House(None, None, n, tn.number_norm(n), x, y, "house", "osm")

    # чётная сторона: 10 (x=0), 14 (x=40) → 12 посередине
    nl = NumberLine([H("10", 0), H("14", 40), H("11", 0, 30), H("21к1", 200, 30)])
    e = nl.estimate("12")
    check(e is not None and e[2] == "same_parity" and abs(e[0] - 20) < 1e-6, f"интерполяция 12: {e}")
    # нечётный 13 — между 11 и 21: разрыв 10, но соседи дальше 150 м → нет точки
    check(nl.estimate("13") is None or nl.estimate("13")[2] == "extrapolated", f"13: {nl.estimate('13')}")
    # «21к2» — та же целая часть, что у «21к1»; соседа той же чётности нет — точка «21к1»
    e = nl.estimate("21к2")
    check(e is not None and e[2] == "same_base" and e[0] == 200, f"same_base: {e}")
    # за краем: 16 после 14 (шаг 10→14 = 40 м) → 20 м дальше края
    e = nl.estimate("16")
    check(e is not None and e[2] == "extrapolated" and abs(e[0] - 60) < 1e-6, f"extrapolated 16: {e}")
    check(nl.estimate("30") is None, "далеко за краем — нет точки")
    # у «1», «1/1», «1/10», «1а» — свои точки между 1 и 3
    nl2 = NumberLine([H("1", 0), H("3", 100)])
    pts = {n: nl2.estimate(n)[0] for n in ("1/1", "1/2", "1/10", "1а", "1к2")}
    check(len(set(round(v, 3) for v in pts.values())) == len(pts) and all(0 < v < 100 for v in pts.values()),
          f"свои точки у номеров с хвостом: {pts}")
    check(fine_pos("21") == 21 and 21 < fine_pos("21а") < fine_pos("21б") < 22 and fine_pos("мтф") is None,
          "fine_pos")
    # «к» с цифрами — корпус, а не буква; хвосты без «потолка» — разные позиции
    tails = ["52к1", "52к2", "50/15", "50/84", "89и", "89к", "36ак11", "36ак12", "401в/1", "401в/2", "21а", "21/1"]
    fp = [fine_pos(n) for n in tails]
    check(len(set(fp)) == len(fp) and all(int(tn.number_base(n)) <= f < int(tn.number_base(n)) + 1
                                          for n, f in zip(tails, fp)), f"fine_pos без совпадений: {fp}")
    check(fine_pos("52к1") < fine_pos("52к2") and sub_parts("52к1") == (52, [(2, 1)]), "корпус")
    sp = spread_positions([f"50/{i}" for i in range(1, 71)] + ["50", "52", "21а"])
    check(len(set(sp.values())) == 71 and max(v for k, v in sp.items() if k.startswith("50/")) < 51
          and abs(sp["21а"] - 21.12) < 1e-9, "spread_positions")
    # улица с двумя нумерациями (два СНТ за 800 м) делится, одна нумерация с одной копией — нет
    def D(n, x, y=0.0):
        return dict(norm=n, x=x, y=y, zone=None, typ="улица")
    two = [D(str(i), i * 10.0) for i in range(1, 11)] + [D(str(i), 800 + i * 10.0) for i in range(1, 11)]
    st_ = collections.Counter()
    gset = [("улица", {str(i) for i in range(1, 11)}), ("улица", {str(i) for i in range(1, 11)} | {"x"})]
    check(len(split_by_numbering([], [], two, gset, st_)) == 1, "ГАР не различает — не делим")
    gset = [("улица", {str(i) for i in range(1, 11)}), ("улица", {f"{i}а" for i in range(1, 11)})]
    two = [dict(d, typ="улица") for d in two[:10]] + [dict(d, typ="улица", norm=d["norm"] + "а") for d in two[10:]] + \
        [dict(d, typ="улица") for d in two[10:13]]
    parts = split_by_numbering([], [], two, gset, st_)
    check(len(parts) == 2 and sorted(len(p[1]) for p in parts) == [10, 13], f"split_by_numbering: {len(parts)}")
    one = [dict(D(str(i), i * 10.0), typ="улица") for i in range(1, 21)] + [dict(D("5", 900.0), typ="улица")]
    check(len(split_by_numbering([], [], one, gset, st_)) == 1, "одна копия — не делим")
    # СНТ: подряд по одной стороне, 435 и 437 → 436
    snt = NumberLine([H("435", 0), H("437", 20)], snt=True)
    e = snt.estimate("436")
    check(e is not None and e[2] == "any_parity" and abs(e[0] - 10) < 1e-6, f"СНТ 436: {e}")
    # в городе противоположная сторона не используется
    city = NumberLine([H("435", 0), H("437", 20)], snt=False)
    check(city.estimate("436") is None, "город: 436 по нечётным не ставим")
    # разночтения имён ГАР↔OSM
    check(spelling_variant("фелицына", "фелицина") and spelling_variant("деповской", "деповский")
          and spelling_variant("тросовая", "троссовая") and not spelling_variant("калиновая", "малиновая")
          and not spelling_variant("кроткий", "короткий") and not spelling_variant("2 темрюкский", "3 темрюкский")
          and not same_digits("35 линия", "36 линия"), "spelling_variant")
    # номера-соседи для выбора копии дома
    check(number_related("14/5", "14/5б") and number_related("14/5", "14/4") and not number_related("14/5", "14/1")
          and number_related("9", "11") and not number_related("9", "10"), "number_related")
    # склейка дублей: один дом на (улица, номер)
    s = Street()
    hs = [House(s, None, "5", "5", 0, 0, "house", "osm"), House(s, None, "5", "5", 1, 1, "street", "gar")]
    check(len(dedupe_houses(hs)) == 1 and dedupe_houses(hs)[0].source == "osm", "dedupe")
    # номера
    check(split_numbers("57; 59") == ["57", "59"] and split_numbers("16А, оф. 407") == ["16А"], "split_numbers")
    check(valid_norm("21к1") and not valid_norm("мтф") and not valid_norm(""), "valid_norm")
    # geo-data.ts читается
    here = os.path.dirname(os.path.abspath(__file__))
    gd = os.path.join(here, "..", "..", "src", "lib", "compare", "geo-data.ts")
    if os.path.exists(gd):
        okr, mic = read_geo_data(gd, "krasnodar")
        check(len(okr) == 4 and len(mic) >= 20 and any("ЮМР" in m["aliases"] for m in mic), "geo-data.ts")
    print("build: ok" if ok else "build: есть ошибки")
    return ok


# ---------------------------------------------------------------- main

def main():
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", required=True)
    ap.add_argument("--gar")
    ap.add_argument("--geo-data", required=True)
    ap.add_argument("--db", help="строка подключения Postgres (или --write-db и GEOCODER_DB_URL)")
    ap.add_argument("--write-db", action="store_true", help="писать в БД по GEOCODER_DB_URL")
    ap.add_argument("--city", default="krasnodar")
    ap.add_argument("--city-name", default="Краснодар")
    ap.add_argument("--report")
    ap.add_argument("--dump")
    args = ap.parse_args()
    stats = {}

    osm = pickle.load(open(args.osm, "rb"))
    okrugs_gd, micro_gd = read_geo_data(args.geo_data, args.city)
    P = build_places(osm, okrugs_gd, micro_gd, args.city_name)
    locate_settlement = settlement_locator(P)
    build_snts(P, osm, locate_settlement)
    stats["snt_labels"] = snt_from_labels(P, osm, locate_settlement)
    log("СНТ по подписям домов:", stats["snt_labels"])
    locate_snt = poly_locator(P.snts)
    log("места:", collections.Counter(p.kind for p in P.all.values()))

    gar_data = read_gar(args.gar) if args.gar else None
    streets, addrs = cluster_streets(P, osm, locate_settlement, locate_snt,
                                     gar_same_name_streets(gar_data[0], gar_data[1]) if gar_data else None)
    stats["osm_addresses"] = len(addrs)
    stats["settlement_vs_addr_city"] = addr_city_agreement(P, addrs)
    log("пункт по полигону vs addr:city:", stats["settlement_vs_addr_city"])
    stats["osm_nodes_snapped"] = snap_nodes(osm, addrs)
    houses = osm_houses(P, streets, addrs, locate_settlement, locate_snt)
    stats["osm_houses"] = len(houses)
    for h in houses:
        if h.street is not None:
            h.street.osm_house_by_norm[h.norm] = h
    for s in streets:
        pt = street_point(s)
        if pt is None:
            hs = list(s.osm_house_by_norm.values()) or [House(None, None, "", "", d["x"], d["y"], "house", "osm")
                                                        for d in s.houses]
            mx = sorted(h.x for h in hs)[len(hs) // 2]
            my = sorted(h.y for h in hs)[len(hs) // 2]
            ref = min(hs, key=lambda h: dist((h.x, h.y), (mx, my)))
            pt = (ref.x, ref.y)
        s.x, s.y = pt

    stats["interpolation_check_osm"] = validate_interpolation(streets)
    log("проверка интерполяции:", stats["interpolation_check_osm"])
    version = f"osm-{osm['maxts']}"
    if args.gar:
        gar_objs, gar_houses, gar_ver = gar_data
        new_streets, new_houses, new_plans = match_gar(P, streets, houses, gar_objs, gar_houses, osm["bare"], stats)
        # центры мест ГАР — медиана точных домов на их улицах; не нашли — место остаётся в центре пункта
        for pl in new_plans:
            P.add(pl)
            (P.snts if pl.kind == "snt" else P.micro).append(pl)
        streets += new_streets
        houses += new_houses
        version += f"+gar-{gar_ver}"
    else:
        gar_objs = {}
    stats["place_parents"] = assign_parents(P, osm, gar_objs)
    streets, houses, stats["trim_to_area"] = trim_to_area(P, streets, houses)
    log("иерархия:", stats["place_parents"], "граница:", stats["trim_to_area"])
    stats["places"] = dict(collections.Counter(p.kind for p in P.all.values()))
    stats["place_parent_fixes"] = P.check_parents()
    # улицы без домов и линий не бывает; улицы без названия-ключа отброшены раньше
    houses = dedupe_houses(houses)
    finalize(P, streets, houses)
    stats["osm_point_check"] = check_osm_points(streets, houses)
    stats["same_name_other_type"] = check_type_pairs(streets, houses)

    stats["reverse_check"] = check_reverse(osm, streets, houses)
    for s_ in streets:
        s_.geom = street_geometry(s_)
    stats["street_geometry"] = dict(streets_with_line=sum(1 for s_ in streets if s_.geom),
                                    points=sum(len(p) for s_ in streets if s_.geom for p in s_.geom))
    log("обратное геокодирование:", stats["reverse_check"], "линии улиц:", stats["street_geometry"])
    stats["osm_duplicate_far_copies"] = getattr(osm_houses, "dup_far", 0)
    stats["osm_duplicate_copy_by_numbering"] = getattr(osm_houses, "by_prediction", 0)
    stats["micro_same_name_merged"] = getattr(build_places, "micro_merged", 0)
    stats["street_types"] = getattr(cluster_streets, "stats", {})
    # у разных номеров одна точка: interpolated с другим interpolated той же улицы (до 0,1 м) и с домом OSM
    # (соседи-опоры в одном здании: «60» и «66» — узлы на одном доме, «62», «64» между ними — это здание)
    shared = collections.Counter((id(h.street), round(h.x, 1), round(h.y, 1)) for h in houses
                                 if h.precision == "interpolated")
    osm_pts = {(id(h.street), round(h.x, 1), round(h.y, 1)) for h in houses if h.precision == "house"}
    stats["interpolated_sharing_point"] = sum(1 for h in houses if h.precision == "interpolated"
                                              and shared[(id(h.street), round(h.x, 1), round(h.y, 1))] > 1)
    stats["interpolated_on_osm_house_point"] = sum(1 for h in houses if h.precision == "interpolated"
                                                   and (id(h.street), round(h.x, 1), round(h.y, 1)) in osm_pts)
    log("точки OSM:", {k: v for k, v in stats["osm_point_check"].items() if k != "top"},
        "интерполяция с общей точкой:", stats["interpolated_sharing_point"])
    # линия без типа и без домов («Подъезд к ж. д. ст. …», «Краснодар — Новороссийск») — не адрес
    dropped = [s for s in streets if s.n_houses == 0 and not s.type]
    streets = [s for s in streets if s.n_houses > 0 or s.type]
    stats["streets_dropped_untyped_empty"] = len(dropped)
    pois = build_pois(P, osm, houses, settlement_locator(P))
    pois = [o for o in pois if (o["place"] is not None and o["place"].id in P.all) or
            (o["place"] is None and in_core(o["x"], o["y"]))]
    counts = dict(places=len(P.all), streets=len(streets), houses=len(house_rows(houses)), pois=len(pois))
    for k, v in collections.Counter(h.precision for h in houses).items():
        counts["houses_" + k] = v
    if args.report:
        report(args.report, P, streets, houses, pois, stats, version)
    if args.dump:
        with open(args.dump, "wb") as f:
            pickle.dump(dict(stats=stats, counts=counts, version=version), f)
    db_url = args.db or (os.environ.get("GEOCODER_DB_URL") if args.write_db else None)
    if args.write_db and not db_url:
        raise SystemExit("--write-db: не задан GEOCODER_DB_URL")
    if db_url:
        write_db(db_url, args.city, version, P, streets, houses, pois, counts)
    log("готово", version, counts)


if __name__ == "__main__":
    main()
