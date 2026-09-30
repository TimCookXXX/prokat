#!/usr/bin/env python3
"""Финальный замер по критериям data/geocoder/PLAN.md (подсказки и координаты) — поверх оценщика разведки.

  1) pnpm exec tsx scripts/geocoder-eval/serve.ts --index data/geocoder/build/index.krasnodar.eval.data.json
  2) python scripts/geocoder-eval/run_eval.py val|test --name final [--i-know-this-is-test]   # geocode, координаты
  3) python scripts/geocoder-eval/final_metrics.py val|test [--i-know-this-is-test]

Подсказки — заново через HTTP: near = центр Краснодара (сайт без места пользователя) и near = точка пользователя
≈1 км от цели (как в scenarios.ts). Засчитывание — evaluate.grade (дом: ключ номера, ядро улицы, ≤150 м).
Группы критерия 1:
  - чистые — сценарии без искажения букв (clean, no_type, formal_full, settlement_*, region_prefix, type_after,
    order_hn_first, caps_punct, case, corpus, noise_apt, drop_title), без доп. опечатки;
  - искажённые — typo1, typo2, phonetic, layout_en, translit или доп. опечатка;
  - улица без номера — street_only, prefix_street.
Срезы: все; «однозначные» — пункт назван или имя улицы есть только в одном пункте; Краснодар.
Координаты и ложная уверенность — из report.final.<set>.<split>.jsonl (шаг 2).
"""
import argparse
import json
import os
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
EVAL = os.path.join(ROOT, "data/geocoder/research/eval")
sys.path.insert(0, EVAL)

import evaluate as ev  # noqa: E402

CLEAN = {"clean", "no_type", "formal_full", "settlement_prefix", "settlement_suffix", "region_prefix", "type_after",
         "order_hn_first", "caps_punct", "case", "corpus", "noise_apt", "drop_title"}
DISTORT = {"typo1", "typo2", "phonetic", "layout_en", "translit"}
STREETS = {"street_only", "prefix_street"}


def group(r):
    if r["scenario"] in STREETS:
        return "улица без номера"
    if r["scenario"] in DISTORT or "+typo1" in r["applied"]:
        return "искажённые"
    return "чистые"


def rank_of(sug, r, lenient=False):
    want = "house" if r["expect"]["level"] == "house" else "street"
    ok = (lambda g: g == "house") if want == "house" else (lambda g: g in ("house", "street"))
    return next((i + 1 for i, c in enumerate(sug) if ok(ev.grade(c, r, lenient=lenient))), None)


def pct(k, n):
    return f"{k / n * 100:.1f}%" if n else "—"


def pctl(xs, q):
    return ev.pct(xs, q)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("split", choices=["val", "test"])
    ap.add_argument("--set", default="v1big")
    ap.add_argument("--http", default="http://127.0.0.1:8765")
    ap.add_argument("--name", default="final", help="отчёт run_eval.py: report.<name>.<набор>.<split>.jsonl")
    ap.add_argument("--i-know-this-is-test", action="store_true")
    a = ap.parse_args()
    if a.split == "test" and not a.i_know_this_is_test:
        sys.exit("Контрольная часть — только на финальном замере: --i-know-this-is-test.")
    path = os.path.join(EVAL, "out/vault" if a.split == "test" else "out", f"queries.{a.set}.{a.split}.jsonl")
    if a.split == "test":
        with open(os.path.join(EVAL, "out", "vault", "OPENED.log"), "a") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M')} final_metrics.py {path}\n")
    rows = [json.loads(l) for l in open(path)]
    import requests
    s = requests.Session()

    def suggest(q, near=None):
        p = {"q": q, "k": 5}
        if near:
            p["near"] = f"{near[0]},{near[1]}"
        return s.get(f"{a.http}/suggest", params=p, timeout=10).json() or []

    res = []
    for r in rows:
        if r["holdout"] != "none":
            continue
        e = r["expect"]
        sc = suggest(r["query"])
        su = suggest(r["query"], (e["lat"] + 0.0064, e["lon"] + 0.009))
        res.append({"r": r, "g": group(r), "c": rank_of(sc, r), "l": rank_of(sc, r, True), "u": rank_of(su, r)})

    L = [f"### Подсказки по группам критерия 1 — {a.split} ({os.path.basename(path)})", "",
         "| группа · срез | n | топ-1 | топ-5 | топ-1 с др. пунктами | топ-5 с др. пунктами | топ-1 у точки пользователя | топ-5 у точки |",
         "|---|---|---|---|---|---|---|---|"]
    subsets = [("все", lambda x: True),
               ("однозначные", lambda x: x["r"]["meta"]["settlement_in_query"] or not x["r"]["meta"]["ambiguous_without_settlement"]),
               ("неоднозначные без пункта", lambda x: not x["r"]["meta"]["settlement_in_query"] and x["r"]["meta"]["ambiguous_without_settlement"]),
               ("Краснодар", lambda x: x["r"]["meta"]["stratum"] == "krd")]
    for g in ["чистые", "искажённые", "чистые + искажённые", "улица без номера"]:
        xs0 = [x for x in res if (x["g"] == g) or (g == "чистые + искажённые" and x["g"] != "улица без номера")]
        for name, f in subsets:
            xs = [x for x in xs0 if f(x)]
            n = len(xs)
            c1 = sum(x["c"] == 1 for x in xs)
            c5 = sum(x["c"] is not None for x in xs)
            l1 = sum(x["l"] == 1 for x in xs)
            l5 = sum(x["l"] is not None for x in xs)
            u1 = sum(x["u"] == 1 for x in xs)
            u5 = sum(x["u"] is not None for x in xs)
            lo, hi = ev.wilson(c1, n)
            L.append(f"| {g} · {name} | {n} | {pct(c1, n)} ({lo * 100:.0f}–{hi * 100:.0f}) | {pct(c5, n)} | {pct(l1, n)} | {pct(l5, n)} | {pct(u1, n)} | {pct(u5, n)} |")

    # координаты и ложная уверенность — по отчёту run_eval.py (geocode строго, near = центр)
    rep = os.path.join(ROOT, "data/geocoder/search-eval", f"report.{a.name}.{a.set}.{a.split}.jsonl")
    if os.path.exists(rep):
        rr = [json.loads(l) for l in open(rep)]
        L += ["", f"### Координаты geocode по заявленной точности — {a.split}", "",
              "| что | n | медиана, м | 90%, м | ≤ 40 м | > 150 м (не тот дом) |", "|---|---|---|---|---|---|"]

        def row(title, ds):
            if not ds:
                return f"| {title} | 0 | | | | |"
            return (f"| {title} | {len(ds)} | {statistics.median(ds):.0f} | {pctl(ds, .9):.0f} | {pct(sum(d <= 40 for d in ds), len(ds))} | "
                    f"{sum(d > 150 for d in ds)} |")
        for ho, t in [("none", "дом в индексе"), ("house", "дом отложен (нет в индексе)")]:
            for lv in ["house", "interpolated", "street"]:
                L.append(row(f"{t}, ответ `{lv}`", [x["dist"] for x in rr if x["holdout"] == ho and x["level1"] == lv and x["dist"] is not None]))
        exact = [x for x in rr if x["level1"] in ("house", "interpolated")]
        wrong = [x for x in exact if x["dist"] > 150 and x["g1"] != "house"]
        wrong_h = [x for x in rr if x["level1"] == "house" and x["dist"] > 150 and x["g1"] != "house"]
        hs = [x for x in rr if x["holdout"] == "street"]
        hs_fp = [x for x in hs if x["level1"] in ("house", "interpolated")]
        hs_fp_far = [x for x in hs_fp if x["dist"] > 150]
        hh = [x for x in rr if x["holdout"] == "house"]
        hh_fp = [x for x in hh if x["level1"] == "house"]
        allq = [x for x in rr if x["level"] == "house"]
        # сводная: ответ с точностью до дома, а дом другой (> 150 м) или нужного дома / улицы нет в данных
        false_conf = [x for x in exact if x["holdout"] != "none" or x["dist"] > 150]
        answered = [x for x in rr if x["level1"]]
        approx = [x for x in answered if x["level1"] in ("street", "settlement")]
        L += ["", f"### Ложная уверенность — {a.split}", "",
              "| определение | доля |", "|---|---|",
              f"| ответ «до дома» (house/interpolated) дальше 150 м от истины, от всех ответов «до дома» | {len(wrong)}/{len(exact)} = {pct(len(wrong), len(exact))} |",
              f"| то же только для `house` (точный дом) | {len(wrong_h)}/{sum(x['level1'] == 'house' for x in rr)} = {pct(len(wrong_h), sum(x['level1'] == 'house' for x in rr))} |",
              f"| то же, от всех запросов к дому (включая отказы) | {len(wrong)}/{len(allq)} = {pct(len(wrong), len(allq))} |",
              f"| улица отложена, ответ «до дома» (оценщик разведки) | {len(hs_fp)}/{len(hs)} = {pct(len(hs_fp), len(hs))} (из них дальше 150 м — {len(hs_fp_far)}) |",
              f"| дом отложен (его нет в данных), ответ `house` | {len(hh_fp)}/{len(hh)} = {pct(len(hh_fp), len(hh))} |",
              f"| дом отложен (его нет в данных), ответ «до дома» (house/interpolated) | {sum(x['level1'] in ('house', 'interpolated') for x in hh)}/{len(hh)} = {pct(sum(x['level1'] in ('house', 'interpolated') for x in hh), len(hh))} |",
              f"| **сводная:** ответ «до дома», а дом другой (> 150 м) или его / улицы нет в данных, от всех ответов «до дома» | {len(false_conf)}/{len(exact)} = {pct(len(false_conf), len(exact))} |",
              f"| доля «≈» (street / пункт) среди ответов geocode | {len(approx)}/{len(answered)} = {pct(len(approx), len(answered))} |"]
    print("\n".join(L))
    out = os.path.join(ROOT, "data/geocoder/search-eval", f"final-metrics{'' if a.name == 'final' else '.' + a.name}.{a.set}.{a.split}.md")
    open(out, "w").write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
