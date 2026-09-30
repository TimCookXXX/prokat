#!/usr/bin/env python3
"""Отложенное из TRAIN-части — чтобы подбирать поведение «дома нет в индексе» / «улицы нет» не глядя в val.

Официальное отложенное (holdout.json) есть только в val/test. Здесь то же правило (10% домов, 5% улиц,
seed 7), но из улиц train, и запросы тем же генератором (gen_queries.render). Пишет:
  data/geocoder/search-eval/holdout.train.json
  data/geocoder/search-eval/queries.trainhold.jsonl   (обычные train-запросы + отложенные)
Индекс без него: build-dev-index.ts --extra-holdout data/geocoder/search-eval/holdout.train.json
"""
import json
import os
import random
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
EVAL = os.path.join(ROOT, "data/geocoder/research/eval")
sys.path.insert(0, EVAL)

from geotext import street_parts, hn_norm, split_of  # noqa: E402
import gen_queries as gq  # noqa: E402


def main():
    rnd = random.Random(7)
    A = [json.loads(l) for l in open(os.path.join(EVAL, "out/addresses.jsonl"))]
    for x in A:
        x["core"] = street_parts(x["street"])[0]
        x["split"] = split_of(x["core"])
        x["hn_key"] = hn_norm(x["hn"])
        x["stratum"] = gq.stratum(x["settlement"])
    by_street = defaultdict(list)
    for x in A:
        by_street[(x["settlement"], x["core"])].append(x)
    by_key = defaultdict(list)
    for x in A:
        by_key[(x["core"], x["hn_key"])].append(x)
    core_settl = defaultdict(set)
    for (s, c) in by_street:
        core_settl[c].add(s)
    held_streets, held_houses = set(), set()
    for k in sorted(by_street):
        if split_of(k[1]) == "train" and len(by_street[k]) >= 3 and rnd.random() < 0.05:
            held_streets.add(k)
    for k in sorted(by_street):
        if split_of(k[1]) == "train" and k not in held_streets and len(by_street[k]) >= 4:
            for x in by_street[k]:
                if rnd.random() < 0.10:
                    held_houses.add(x["osm"])
    out = os.path.join(ROOT, "data/geocoder/search-eval")
    os.makedirs(out, exist_ok=True)
    json.dump({"houses": sorted(held_houses), "streets": [{"settlement": s, "core": c} for s, c in sorted(held_streets)]},
              open(os.path.join(out, "holdout.train.json"), "w"), ensure_ascii=False)

    strata_w = {"krd": .60, "near": .25, "other": .15}
    pools = defaultdict(list)
    for x in A:
        if x["split"] == "train":
            pools[x["stratum"]].append(x)
    rows = []
    for kind, n in (("house", 300), ("street", 140)):
        got = 0
        while got < n:
            st = rnd.choices(list(strata_w), weights=list(strata_w.values()))[0]
            x = rnd.choice(pools[st])
            sk = (x["settlement"], x["core"])
            if kind == "house" and x["osm"] not in held_houses:
                continue
            if kind == "street" and sk not in held_streets:
                continue
            sc = rnd.choice(["clean", "no_type", "settlement_suffix", "typo1"])
            if sc == "settlement_suffix" and x["settlement_src"] == "nearest_node":
                sc = "no_type"
            q, applied, level = gq.render(x, sc, rnd, [])
            has_settl = sc == "settlement_suffix"
            others = sorted(core_settl[x["core"]] - {x["settlement"]})
            pts = by_street[sk]
            pts = pts if len(pts) <= 40 else random.Random(x["osm"]).sample(pts, 40)
            rows.append({
                "id": f"th-{len(rows) + 1:05d}", "split": "train", "query": q, "scenario": sc, "applied": applied, "holdout": kind,
                "expect": {"level": "house" if kind == "house" else "settlement_or_none", "settlement": x["settlement"],
                           "street": x["street"], "core": x["core"], "hn": x["hn"], "hn_key": x["hn_key"], "osm": x["osm"],
                           "lat": x["lat"], "lon": x["lon"], "street_pts": [[p["lon"], p["lat"]] for p in pts],
                           "alternatives": [{"settlement": y["settlement"], "lat": y["lat"], "lon": y["lon"], "osm": y["osm"]}
                                            for y in by_key[(x["core"], x["hn_key"])] if y["osm"] != x["osm"]][:20]},
                "meta": {"stratum": x["stratum"], "settlement_in_query": has_settl, "same_street_in_other_settlements": len(others),
                         "ambiguous_without_settlement": bool(others) and not has_settl,
                         "hn_complex": bool(gq.COMPLEX_HN.search(x["hn"])), "is_building": x["building"] is not None},
            })
            got += 1
    with open(os.path.join(out, "queries.trainhold.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"held houses {len(held_houses)}, streets {len(held_streets)}, queries {len(rows)}")


if __name__ == "__main__":
    main()
