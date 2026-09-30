#!/usr/bin/env python3
"""Замер своего геокодера оценщиком разведки (data/geocoder/research/eval/evaluate.py) через HTTP.

  1) pnpm exec tsx scripts/geocoder-eval/serve.ts --index data/geocoder/build/dev-index.eval.json
  2) python scripts/geocoder-eval/run_eval.py train|val [--name v1] [--set v1big]

Отчёт — data/geocoder/search-eval/report.<name>.<набор>.md (+ .jsonl для диффа версий).
Контрольная часть (vault) открывается только на финальном замере: split test + --i-know-this-is-test,
вскрытие пишется в research/eval/out/vault/OPENED.log.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
EVAL = os.path.join(ROOT, "data/geocoder/research/eval")
sys.path.insert(0, EVAL)

import evaluate as ev  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("split", choices=["train", "val", "test"])
    ap.add_argument("--set", default="v1big")
    ap.add_argument("--name", default="inrenta")
    ap.add_argument("--http", default="http://127.0.0.1:8765")
    ap.add_argument("--keystrokes", type=int, default=100)
    ap.add_argument("--i-know-this-is-test", action="store_true")
    a = ap.parse_args()
    if a.split == "test" and not a.i_know_this_is_test:
        sys.exit("Контрольная часть открывается один раз, на финальном замере: добавьте --i-know-this-is-test.")
    sub = "out/vault" if a.split == "test" else "out"
    path = os.path.join(EVAL, sub, f"queries.{a.set}.{a.split}.jsonl")
    if a.split == "test":
        with open(os.path.join(EVAL, "out", "vault", "OPENED.log"), "a") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M')} {a.name} {path} (run_eval.py)\n")
    rows = [json.loads(l) for l in open(path)]
    g = ev.Http(a.http)
    g.name = a.name
    res, lat_s, lat_g, ks = ev.run(rows, g, keystrokes=a.keystrokes)
    md = ev.report(res, lat_s, lat_g, ks, a.name, path)
    out_dir = os.path.join(ROOT, "data/geocoder/search-eval")
    os.makedirs(out_dir, exist_ok=True)
    base = f"report.{a.name}.{a.set}.{a.split}"
    open(os.path.join(out_dir, base + ".md"), "w").write(md)
    with open(os.path.join(out_dir, base + ".jsonl"), "w") as f:
        for x in res:
            f.write(json.dumps({"id": x["id"], "query": x["r"]["query"], "scenario": x["r"]["scenario"], "rank": x["rank"],
                                "rank_l": x["rank_l"], "g1": x["g1"], "dist": x["dist"], "level1": x["level1"],
                                "expect": {k: x["r"]["expect"][k] for k in ("settlement", "street", "hn", "lat", "lon")},
                                "holdout": x["r"]["holdout"], "meta": x["r"]["meta"], "applied": x["r"]["applied"],
                                "alternatives": len(x["r"]["expect"].get("alternatives", [])), "level": x["r"]["expect"]["level"],
                                "top": x["top"]},
                               ensure_ascii=False) + "\n")
    print(md)


if __name__ == "__main__":
    main()
