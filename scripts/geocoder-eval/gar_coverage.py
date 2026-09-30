#!/usr/bin/env python3
"""Доля адресов ГАР Краснодара, найденных «до дома» (точность данных house / interpolated).

  docker exec inrenta-dev psql -U app -d app -Atc "copy (select gar_guid, precision, source from geo_houses
      where gar_guid is not null) to stdout with csv" > /tmp/db_gar.csv
  python scripts/geocoder-eval/gar_coverage.py /tmp/db_gar.csv

Адрес ГАР — (пункт, план, улица, номер, корпус/строение); дом и участок с одним адресом — один адрес. Гаражи не
считаются (импорт их не берёт). Найден — хоть один GUID адреса есть в geo_houses; точность — лучшая из них.
Город — дома с пунктом ГАР «г. Краснодар» (293930); округ — плюс пункты с корнем «г. Краснодар» (посёлки в черте).
"""
import collections
import csv
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../.."))
GAR = os.path.join(ROOT, "data/geocoder/work/gar")
KRD = "293930"
db = {r[0]: r[1] for r in csv.reader(open(sys.argv[1]))}
obj = {r["objectid"]: r for r in csv.DictReader(open(os.path.join(GAR, "gar_objects.csv")))}
okrug = {k for k, v in obj.items() if v["root"] == KRD and v["level"] in ("5", "6")} | {KRD}
groups = {}
for r in csv.DictReader(open(os.path.join(GAR, "gar_houses.csv"))):
    if r["housetype"] == "г-ж" or r["settlement"] not in okrug:
        continue
    key = (r["settlement"], r["plan"], r["street"], r["housenum"].lower().replace(" ", ""), r["addtype1"],
           r["addnum1"].lower(), r["addtype2"], r["addnum2"].lower())
    g = groups.setdefault(key, {"city": r["settlement"] == KRD, "prec": []})
    if r["guid"] in db:
        g["prec"].append(db[r["guid"]])
RANK = {"house": 0, "interpolated": 1, "street": 2, "place": 3}
for scope in ("город", "городской округ"):
    gs = [g for g in groups.values() if scope == "городской округ" or g["city"]]
    n = len(gs)
    c = collections.Counter(min(g["prec"], key=RANK.get) if g["prec"] else "нет в индексе" for g in gs)
    print(f"{scope}: адресов {n}; " + ", ".join(f"{k} {v} ({v / n * 100:.1f}%)" for k, v in c.most_common())
          + f"; до дома (house + interpolated) {(c['house'] + c['interpolated']) / n * 100:.1f}%; в индексе {(n - c['нет в индексе']) / n * 100:.1f}%")
