// Замер подсказок по сценариям в процессе (без HTTP) + метрики набора по буквам и неоднозначности.
// Засчитывание — как evaluate.py: ядро улицы похоже (ratio ≥ 88), дом — ключ номера и ≤ 150 м, улица — ≤ 500 м
// от домов улицы.
//
//   pnpm exec tsx scripts/geocoder-eval/scenarios.ts [--split train|val] [--index …] [--misses street_only,prefix_street] [--n 30]
//
// Метрики сверх evaluate.py:
//  - «набор»: для чистых запросов к дому — каждый префикс запроса («б», «ба», …, «базовская 2», …, полный);
//    доля префиксов от 3 букв ядра, где нужная улица (или дом) в топ-5, и сколько букв нужно до топ-1/топ-5;
//  - «неоднозначность»: запросы без пункта, у которых тот же адрес есть в 2–5 пунктах, — доля, где ВСЕ варианты в топ-5,
//    и различимы ли подписи; топ-1 при near = точка пользователя рядом с целью (≈1 км).
// Контрольная часть (vault) — только на финальном замере: --split test --i-know-this-is-test (вскрытие — в vault/OPENED.log).

import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as current from "@/lib/geocoder/engine";
import * as currentBuild from "@/lib/geocoder/index-build";
import { houseKey } from "@/lib/geocoder/house-number";
import type { AddressHit, GeoIndexData } from "@/lib/geocoder/types";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const split = opt("--split", "train");
if (split === "test" && !args.includes("--i-know-this-is-test")) throw new Error("Контрольная часть — только для финального замера (--i-know-this-is-test).");
const ROOT = resolve(import.meta.dirname, "../..");
// --engine <папка> — другая версия движка (копия src/lib/geocoder) для сравнения «было / стало» на тех же данных
const engineDir = opt("--engine", "");
const mod = (engineDir ? await import(resolve(engineDir, "engine.ts")) : current) as typeof current;
const modBuild = (engineDir ? await import(resolve(engineDir, "index-build.ts")) : currentBuild) as typeof currentBuild;
const { Engine, RANK } = mod;
const MATCH = (mod as { MATCH?: Record<string, number> }).MATCH ?? {};
const { buildIndex, haversineKm } = modBuild;
let t0 = performance.now();
const ix = buildIndex(JSON.parse(readFileSync(resolve(ROOT, opt("--index", "data/geocoder/build/index.krasnodar.eval.json")), "utf8")) as GeoIndexData);
let engine = new Engine(ix);
console.error(`индекс: ${Math.round(performance.now() - t0)} мс`);

interface Alt { settlement: string; lat: number; lon: number }
interface Row {
  query: string;
  scenario: string;
  holdout: string;
  applied: string[];
  expect: { level: string; settlement: string; street: string; core: string; hn: string | null; hn_key: string | null; lat: number; lon: number; street_pts: [number, number][]; alternatives?: Alt[] };
  meta: { settlement_in_query: boolean; ambiguous_without_settlement: boolean; stratum: string };
}
const rowsPath = resolve(ROOT, `data/geocoder/research/eval/out/${split === "test" ? "vault/" : ""}queries.${opt("--set", "v1big")}.${split}.jsonl`);
if (split === "test") appendFileSync(resolve(ROOT, "data/geocoder/research/eval/out/vault/OPENED.log"), `${new Date().toLocaleString("sv-SE").slice(0, 16)} scenarios.ts ${rowsPath}\n`);
const rows = readFileSync(rowsPath, "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row).filter((r) => r.holdout === "none");

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
/** rapidfuzz.fuzz.ratio: 100 × (1 − indel / (|a| + |b|)). */
function ratio(a: string, b: string): number {
  if (a === b) return 100;
  const m = a.length;
  const n = b.length;
  const dp = new Int32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return (200 * dp[n]) / (m + n);
}
const coreOk = (street: string | null | undefined, c: string) => !!street && (core(street) === c || ratio(core(street), c) >= 88);

type Grade = "house" | "street" | null;
function grade(h: AddressHit, r: Row, at?: { lat: number; lon: number }): Grade {
  const e = r.expect;
  if (!coreOk(h.parts?.street, e.core)) return null;
  const truth = at ?? e;
  // вариант из индекса — «тот же дом там же» с допуском 0,5 км (точку дома из ГАР движок уточняет по соседям)
  if (e.hn_key && h.parts?.house && houseKey(h.parts.house) === e.hn_key && haversineKm(h, truth) <= (at ? 0.5 : 0.15)) return "house";
  if (at) return null;
  return e.street_pts.some(([lon, lat]) => haversineKm(h, { lat, lon }) <= 0.5) ? "street" : null;
}
const ok = (g: Grade, r: Row) => (r.expect.level === "house" ? g === "house" : g !== null);
const rankOf = (hits: AddressHit[], r: Row) => hits.findIndex((h) => ok(grade(h, r), r));

const CENTER = { lat: 45.0355, lon: 38.9753 };
const pct = (x: number, n: number) => (n ? `${Math.round((x / n) * 1000) / 10}%` : "—");

function measure(compact: boolean): string {
  // ------------------------------------------------------------------ сценарии
  const by = new Map<string, { n: number; t1: number; t5: number }>();
  const bump = (k: string, rank: number) => {
    const s = by.get(k) ?? { n: 0, t1: 0, t5: 0 };
    s.n++;
    if (rank === 0) s.t1++;
    if (rank >= 0) s.t5++;
    by.set(k, s);
  };
  const missesFor = new Set(opt("--misses", "").split(",").filter(Boolean));
  const maxMiss = Number(opt("--n", "30"));
  let shown = 0;
  const lat: number[] = [];
  for (const r of rows) {
    t0 = performance.now();
    const hits = engine.suggest(r.query, { limit: 5, near: CENTER });
    lat.push(performance.now() - t0);
    const rank = rankOf(hits, r);
    bump("все", rank);
    bump(r.scenario, rank);
    if (!r.meta.settlement_in_query && !r.meta.ambiguous_without_settlement) bump("без пункта, однозначные", rank);
    if (r.meta.stratum === "krd") bump("Краснодар", rank);
    if ((missesFor.has(r.scenario) || missesFor.has("all")) && rank !== 0 && !(args.includes("--unamb") && r.meta.ambiguous_without_settlement && !r.meta.settlement_in_query) && shown++ < maxMiss) {
      console.log(`[${r.scenario}] «${r.query}» → ${r.expect.settlement} · ${r.expect.street} · ${r.expect.hn ?? "—"} (rank ${rank}${r.meta.ambiguous_without_settlement ? ", неоднозн." : ""})`);
      for (const h of hits) console.log(`      ${h.score.toFixed(1).padStart(6)} ${h.title} — ${h.subtitle} [${h.precision}] ${Math.round(haversineKm(h, r.expect) * 1000)} м`);
    }
  }

  // ------------------------------------------------------------------ неоднозначность
  const streetsByCore = new Map<string, number[]>();
  engine.ix.streets.forEach((st, i) => {
    const c = core(st.name);
    const arr = streetsByCore.get(c);
    if (arr) arr.push(i);
    else streetsByCore.set(c, [i]);
  });
  function variantsInIndex(r: Row): { lat: number; lon: number }[] {
    const ix = engine.ix;
    const out: { lat: number; lon: number }[] = [];
    for (const si of streetsByCore.get(r.expect.core) ?? []) {
      const st = ix.streets[si];
      for (let j = st.start; j < st.end; j++) {
        if (ix.hKey[j] !== r.expect.hn_key) continue;
        const p = { lat: ix.hLat[j], lon: ix.hLon[j] };
        if (!out.some((q) => haversineKm(p, q) < 0.5)) out.push(p);
      }
    }
    return out;
  }
  let ambN = 0, ambAll = 0, ambDistinct = 0, userN = 0, user1 = 0, user5 = 0, userSN = 0, userS1 = 0, userS5 = 0;
  for (const r of rows) {
    if (r.meta.settlement_in_query || !r.meta.ambiguous_without_settlement) continue;
    // точка пользователя ≈1 км от цели (на северо-восток)
    const user = { lat: r.expect.lat + 0.0064, lon: r.expect.lon + 0.009 };
    const hu = engine.suggest(r.query, { limit: 5, near: user });
    const ru = rankOf(hu, r);
    if (r.expect.level !== "house") {
      userSN++;
      if (ru === 0) userS1++;
      if (ru >= 0) userS5++;
      continue;
    }
    userN++;
    if (ru !== 0 && missesFor.has("user") && shown++ < maxMiss) {
      console.log(`[user] «${r.query}» → ${r.expect.settlement} · ${r.expect.street} · ${r.expect.hn} (rank ${ru})`);
      for (const h of hu) console.log(`      ${h.score.toFixed(1).padStart(6)} ${h.title} — ${h.subtitle} [${h.precision}] ${Math.round(haversineKm(h, r.expect) * 1000)} м`);
    }
    if (ru === 0) user1++;
    if (ru >= 0) user5++;
    // варианты — по самому индексу: тот же номер на улицах с тем же ядром названия (куски одной улицы ближе 0,5 км — один)
    const pts = variantsInIndex(r);
    if (pts.length < 2 || pts.length > 5) continue;
    ambN++;
    const hits = engine.suggest(r.query, { limit: 5, near: CENTER });
    if (pts.every((p) => hits.some((h) => grade(h, r, p) === "house"))) ambAll++;
    else if (missesFor.has("amb") && shown++ < maxMiss) {
      console.log(`[amb] «${r.query}» → ${pts.length} вариантов`);
      for (const h of hits) console.log(`      ${h.score.toFixed(1).padStart(6)} ${h.title} — ${h.subtitle} [${h.precision}] ${pts.some((p) => grade(h, r, p) === "house") ? "✓" : ""}`);
    }
    const labels = hits.map((h) => `${h.title}|${h.subtitle}`);
    if (new Set(labels).size === labels.length) ambDistinct++;
  }

  // ------------------------------------------------------------------ набор по буквам
  // Чистые запросы к дому: все префиксы («б», «ба», …, «базовская 2», …, полный). Два режима:
  //  krd — near = центр Краснодара, только цели в Краснодаре (сайт без места пользователя);
  //  user — near = точка пользователя ≈1 км от цели, все цели.
  // Считаем: доля префиксов от 3 букв, где нужная улица в топ-5 (и в топ-1); доля строки до улицы в топ-5;
  // доля префиксов после начала номера, где нужный дом в топ-5 (частичный номер → дома с этим началом).
  interface Ks { n: number; pref: number; prefOk5: number; prefOk1: number; num: number; numOk: number; full: number; full1: number; full5: number; need: number[]; missing: number }
  const ksRun = (mode: "krd" | "user"): Ks => {
    const res: Ks = { n: 0, pref: 0, prefOk5: 0, prefOk1: 0, num: 0, numOk: 0, full: 0, full1: 0, full5: 0, need: [], missing: 0 };
    const showKs = missesFor.has("ks-" + mode);
    let shownKs = 0;
    const cand = rows.filter((r) => r.expect.level === "house" && (r.scenario === "clean" || r.scenario === "no_type") && (mode === "user" || r.meta.stratum === "krd"))
      .slice(0, Number(opt("--ks", "150")));
    const letters = (s: string) => (s.match(/[а-яёa-z]/gi) ?? []).length;
    for (const r of cand) {
      res.n++;
      const q = r.query;
      const near = mode === "krd" ? CENTER : { lat: r.expect.lat + 0.0064, lon: r.expect.lon + 0.009 };
      let first = -1;
      const hn = r.expect.hn ?? "";
      // начало номера — последнее число запроса, начинающееся с первой цифры номера
      let hnAt = -1;
      for (const m of q.matchAll(/(?:^|[\s,])(\d)/g)) if (m[1] === hn[0]) hnAt = (m.index ?? 0) + m[0].length - 1;
      for (let n = 1; n <= q.length; n++) {
        const p = q.slice(0, n);
        if (/[\s,.]$/.test(p) && n < q.length) continue;
        const hits = engine.suggest(p, { limit: 5, near });
        const isStreet = (h: AddressHit) => coreOk(h.parts?.street, r.expect.core) && r.expect.street_pts.some(([lon, lat]) => haversineKm(h, { lat, lon }) <= 0.5);
        const si = hits.findIndex(isStreet);
        if (letters(p) >= 3 && (hnAt < 0 || n <= hnAt)) {
          res.pref++;
          if (si >= 0) res.prefOk5++;
          if (si === 0) res.prefOk1++;
          else if (showKs && shownKs++ < maxMiss) console.log(`[ks-${mode}] «${p}» → ${r.expect.settlement} · ${r.expect.street} (улица ${si}): ${hits.slice(0, 3).map((h) => `${h.title} — ${h.subtitle}`).join(" | ")}`);
        }
        if (hnAt >= 0 && n > hnAt) {
          // номер набирается: нужный дом среди подсказок, если его номер начинается с набранного
          const typed = houseKey(p.slice(hnAt));
          if (typed && r.expect.hn_key?.startsWith(typed)) {
            const hi = hits.findIndex((h) => grade(h, r) === "house");
            if (typed === r.expect.hn_key) {
              // номер набран целиком: дом в топ-1 / топ-5
              res.full++;
              if (hi === 0) res.full1++;
              if (hi >= 0) res.full5++;
              else if (showKs && shownKs++ < maxMiss) console.log(`[ks-${mode}#] «${p}» → ${r.expect.street}, ${r.expect.hn}: ${hits.slice(0, 3).map((h) => `${h.title} — ${h.subtitle}`).join(" | ")}`);
            } else {
              // частичный номер: первая подсказка — дом этой улицы, чей номер начинается с набранного (или сам дом)
              res.num++;
              const h0 = hits[0];
              if (h0 && coreOk(h0.parts?.street, r.expect.core) && h0.parts?.house && houseKey(h0.parts.house).startsWith(typed)) res.numOk++;
              else if (showKs && shownKs++ < maxMiss) console.log(`[ks-${mode}~] «${p}» → ${r.expect.street}, ${r.expect.hn}: ${hits.slice(0, 3).map((h) => `${h.title} — ${h.subtitle}`).join(" | ")}`);
            }
          }
        }
        if (si >= 0 && first < 0) first = n;
      }
      if (first < 0) res.missing++;
      else res.need.push(first / q.length);
    }
    return res;
  };
  const ks = { krd: ksRun("krd"), user: ksRun("user") };
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
  const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? NaN;

  if (compact) {
    const a = by.get("все")!, ps = by.get("prefix_street")!, so = by.get("street_only")!;
    return `все ${pct(a.t1, a.n)}/${pct(a.t5, a.n)} · prefix ${pct(ps.t1, ps.n)}/${pct(ps.t5, ps.n)} · street_only ${pct(so.t1, so.n)}/${pct(so.t5, so.n)}`
      + ` · варианты ${pct(ambAll, ambN)} · user ${pct(user1, userN)}/${pct(userS1, userSN)} · набор krd ${pct(ks.krd.prefOk1, ks.krd.pref)}/${pct(ks.krd.prefOk5, ks.krd.pref)}`
      + ` user ${pct(ks.user.prefOk1, ks.user.pref)}/${pct(ks.user.prefOk5, ks.user.pref)} · номер ${pct(ks.krd.numOk, ks.krd.num)}`;
  }
  console.log(`\n## ${split}: ${rows.length} запросов\n`);
  console.log("| срез | n | топ-1 | топ-5 |\n|---|---|---|---|");
  for (const [k, s] of [...by].sort((a, b) => (a[0] === "все" ? -1 : b[0] === "все" ? 1 : b[1].n - a[1].n))) console.log(`| ${k} | ${s.n} | ${pct(s.t1, s.n)} | ${pct(s.t5, s.n)} |`);
  console.log(`\nНеоднозначность (без пункта, тот же дом в 2–5 местах индекса): n=${ambN}, все варианты в топ-5 ${pct(ambAll, ambN)}, подписи различимы ${pct(ambDistinct, ambN)}`);
  console.log(`Без пункта, неоднозначные, near = точка пользователя ≈1 км от цели: дома n=${userN}, топ-1 ${pct(user1, userN)}, топ-5 ${pct(user5, userN)}; улицы (street_only, prefix_street) n=${userSN}, топ-1 ${pct(userS1, userSN)}, топ-5 ${pct(userS5, userSN)}`);
  for (const [mode, k] of Object.entries(ks)) {
    console.log(`Набор по буквам ${mode} (clean/no_type, n=${k.n}): префиксы от 3 букв — улица в топ-1 ${pct(k.prefOk1, k.pref)}, в топ-5 ${pct(k.prefOk5, k.pref)};`
      + ` частичный номер — первым дом улицы с этим началом ${pct(k.numOk, k.num)}; номер целиком (префикс) — дом в топ-1 ${pct(k.full1, k.full)}, топ-5 ${pct(k.full5, k.full)}; доля строки до улицы в топ-5 — медиана ${Math.round(med(k.need) * 100)}%, p95 ${Math.round(p95(k.need) * 100)}%; не появилась ${k.missing}`);
  }
  console.log(`suggest: p50 ${med(lat).toFixed(2)} мс, p95 ${p95(lat).toFixed(2)} мс`);
  // geocode (строго, как импорт): доля ответов «тот дом», чужих, и причины отказов
  const reasons = new Map<string, number>();
  let gOk = 0, gWrong = 0, gN = 0, gAmbWithPlace = 0;
  for (const r of rows) {
    if (r.expect.level !== "house") continue;
    gN++;
    if (!("geocodeDetailed" in engine)) break;
    const res = engine.geocodeDetailed(r.query, { near: CENTER });
    if (res.hit) {
      if (grade(res.hit, r) === "house") gOk++;
      else gWrong++;
    } else {
      reasons.set(res.reason!, (reasons.get(res.reason!) ?? 0) + 1);
      if (res.reason === "ambiguous_place" && r.meta.settlement_in_query) gAmbWithPlace++;
    }
  }
  console.log(`geocode (строго), запросы к дому n=${gN}: тот дом ${pct(gOk, gN)}, другой ответ ${pct(gWrong, gN)}; отказы: `
    + [...reasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, gN)}`).join(", ") + `; «уточните пункт» при названном пункте: ${gAmbWithPlace}`);
  return "";
}

// --grid '{"RANK.trailCredit":[0.5,0.7],"MATCH.prefixSpan":[0.3,0.4]}' — перебор параметров (новый движок на каждый набор)
const grid: Record<string, number[]> = JSON.parse(opt("--grid", "{}"));
const combos: Record<string, number>[] = [{}];
for (const k of Object.keys(grid)) combos.splice(0, combos.length, ...combos.flatMap((c) => grid[k].map((v) => ({ ...c, [k]: v }))));
const baseRank = { ...RANK };
const baseMatch = { ...MATCH };
for (const c of combos) {
  Object.assign(RANK, baseRank);
  Object.assign(MATCH, baseMatch);
  for (const [k, v] of Object.entries(c)) {
    const [obj, key] = k.split(".");
    (obj === "MATCH" ? (MATCH as Record<string, number>) : (RANK as Record<string, number>))[key] = v;
  }
  engine = new Engine(ix);
  const line = measure(combos.length > 1);
  if (line) console.log(JSON.stringify(c), line);
}
