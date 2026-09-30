// Подбор весов ранжирования на train-части набора замера (в процессе, без HTTP). Засчитывание — упрощённая
// копия evaluate.py: дом — ключ номера и ≤ 150 м; улица — ядро названия и ≤ 500 м от домов улицы.
//
//   pnpm exec tsx scripts/geocoder-eval/tune.ts [--index data/geocoder/build/dev-index.eval.json] [--set v1big] [--split train]
//
// Контрольная часть (vault) не читается. Val — только для сравнения версий (run_eval.py), не для подбора.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Engine, RANK } from "@/lib/geocoder/engine";
import { buildIndex, haversineKm } from "@/lib/geocoder/index-build";
import { houseKey } from "@/lib/geocoder/house-number";
import type { AddressHit, GeoIndexData } from "@/lib/geocoder/types";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const split = opt("--split", "train");
if (split === "test") throw new Error("Контрольная часть — только для финального замера.");
const ROOT = resolve(import.meta.dirname, "../..");
const engine = new Engine(buildIndex(JSON.parse(readFileSync(resolve(ROOT, opt("--index", "data/geocoder/build/dev-index.eval.json")), "utf8")) as GeoIndexData));

interface Row {
  query: string;
  scenario: string;
  holdout: string;
  expect: { level: string; core: string; hn_key: string | null; lat: number; lon: number; street_pts: [number, number][] };
  meta: { settlement_in_query: boolean; ambiguous_without_settlement: boolean };
}
const qfile = split === "trainhold" ? "data/geocoder/search-eval/queries.trainhold.jsonl" : `data/geocoder/research/eval/out/queries.${opt("--set", "v1big")}.${split}.jsonl`;
const allRows = readFileSync(resolve(ROOT, qfile), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
const rows = allRows.filter((r) => r.holdout === "none");
const heldHouse = allRows.filter((r) => r.holdout === "house");
const heldStreet = allRows.filter((r) => r.holdout === "street");

const TYPES = new Set(["улица", "проспект", "переулок", "проезд", "бульвар", "площадь", "шоссе", "набережная", "микрорайон", "тупик", "аллея", "квартал", "территория"]);
function core(name: string): string {
  let typ = false;
  const out: string[] = [];
  for (const w of name.toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я/]+/g, " ").trim().split(" ")) {
    if (!typ && TYPES.has(w)) {
      typ = true;
      continue;
    }
    if (w === "имени" || w === "им") continue;
    out.push(w);
  }
  return out.join(" ");
}

function grade(h: AddressHit, r: Row): boolean {
  const e = r.expect;
  if (!h.parts?.street || core(h.parts.street) !== e.core) return false;
  if (e.level === "house") return !!h.parts.house && houseKey(h.parts.house) === e.hn_key && haversineKm(h, e) <= 0.15;
  return e.street_pts.some(([lon, lat]) => haversineKm(h, { lat, lon }) <= 0.5);
}

const near = { lat: 45.0355, lon: 38.9753 };
const strict = opt("--strict", "1") === "1";
const showMisses = Number(opt("--misses", "0"));
let shown = 0;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
}
/** Отложенное: дом — geocode ≤ 500 м от улицы (медиана до истины), улица — доля «дом/интерполяция» (ложная уверенность). */
function runHeld(): Record<string, number> {
  if (!heldHouse.length) return {};
  const d: number[] = [];
  let ok = 0;
  for (const r of heldHouse) {
    const h = engine.geocode(r.query, { near, strict });
    const dist = h ? haversineKm(h, r.expect) * 1000 : 1e6;
    d.push(dist);
    if (h && h.parts?.street && core(h.parts.street) === r.expect.core && r.expect.street_pts.some(([lon, lat]) => haversineKm(h, { lat, lon }) <= 0.5)) ok++;
  }
  let fc = 0;
  for (const r of heldStreet) {
    const h = engine.geocode(r.query, { near, strict });
    if (h && (h.precision === "house" || h.precision === "interpolated")) fc++;
  }
  const sorted = [...d].sort((a, b) => a - b);
  return {
    heldOk: Math.round((ok / heldHouse.length) * 1000) / 10, heldMed: Math.round(median(d)), held90: Math.round(sorted[Math.floor(sorted.length * 0.9)]),
    falseConf: Math.round((fc / heldStreet.length) * 1000) / 10,
  };
}

function run(): { top1: number; top5: number; amb1: number; amb5: number; street5: number; geoHouse?: number; geoNull?: number; geoWrongKrd?: number } {
  let t1 = 0, t5 = 0, a1 = 0, a5 = 0, an = 0, s5 = 0, sn = 0;
  for (const r of rows) {
    const hits = engine.suggest(r.query, { limit: 5, near });
    const rank = hits.findIndex((h) => grade(h, r));
    if (showMisses && rank !== 0 && shown++ < showMisses) {
      console.log(`[${r.scenario}] ${r.query} → ждали ${(r.expect as unknown as { settlement: string; street: string }).settlement} · ${(r.expect as unknown as { street: string }).street} · ${r.expect.hn_key ?? "—"} (rank ${rank})`);
      for (const h of hits.slice(0, 3)) console.log(`      ${h.title} — ${h.subtitle} [${h.precision}] ${Math.round(haversineKm(h, r.expect) * 1000)} м`);
    }
    if (rank === 0) t1++;
    if (rank >= 0) t5++;
    if (r.meta.ambiguous_without_settlement) {
      an++;
      if (rank === 0) a1++;
      if (rank >= 0) a5++;
    }
    if (r.expect.level === "street") {
      sn++;
      if (rank >= 0) s5++;
    }
  }
  const p = (x: number, n: number) => Math.round((x / n) * 1000) / 10;
  // geocode на обычных запросах к домам: доля «до дома», отказов и чужих ответов
  let gh = 0, gn = 0, gnull = 0, gwrongKrd = 0;
  for (const r of rows) {
    if (r.expect.level !== "house") continue;
    gn++;
    const h = engine.geocode(r.query, { near, strict });
    if (!h) gnull++;
    else if (grade(h, r)) gh++;
    else if (h.subtitle.startsWith("Краснодар")) gwrongKrd++;
  }
  return {
    top1: p(t1, rows.length), top5: p(t5, rows.length), amb1: p(a1, an), amb5: p(a5, an), street5: p(s5, sn),
    geoHouse: p(gh, gn), geoNull: p(gnull, gn), geoWrongKrd: p(gwrongKrd, gn),
  } as ReturnType<typeof run>;
}

const grid: Record<string, number[]> = JSON.parse(opt("--grid", "{}"));
const keys = Object.keys(grid);
const combos: Record<string, number>[] = [{}];
for (const k of keys) {
  const next: Record<string, number>[] = [];
  for (const c of combos) for (const v of grid[k]) next.push({ ...c, [k]: v });
  combos.splice(0, combos.length, ...next);
}
const base = { ...RANK };
for (const c of combos) {
  Object.assign(RANK, base, c);
  const t = performance.now();
  const m = run();
  console.log(JSON.stringify(c), m, runHeld(), `${Math.round(performance.now() - t)} мс`);
}
