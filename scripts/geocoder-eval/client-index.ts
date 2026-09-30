// Клиентский мини-индекс: размер (сырой и gzip), время сборки на сервере и в «браузере», совпадение подсказок
// с сервером на префиксах запросов train (без номеров), скорость подсказок по мини-индексу.
//
//   pnpm exec tsx scripts/geocoder-eval/client-index.ts [--index data/geocoder/build/index.krasnodar.json] [--out файл.json]

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { buildClientIndex, createClientGeocoder, createGeocoder } from "@/lib/geocoder";
import type { GeoIndexData } from "@/lib/geocoder/types";

const args = process.argv.slice(2);
const opt = (name: string, def: string | null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const ROOT = resolve(import.meta.dirname, "../..");
const data = JSON.parse(readFileSync(resolve(ROOT, opt("--index", "data/geocoder/build/index.krasnodar.json")!), "utf8")) as GeoIndexData;

let t = performance.now();
const ci = buildClientIndex(data);
const json = JSON.stringify(ci);
const buildMs = performance.now() - t;
const out = opt("--out", null);
if (out) writeFileSync(resolve(out), json);
t = performance.now();
const cg = createClientGeocoder(JSON.parse(json));
const clientMs = performance.now() - t;
console.log(`мини-индекс: ${ci.places.length} пунктов, ${ci.streets.length} улиц, ${ci.pois.length} объектов; `
  + `${Math.round(json.length / 1024)} КБ, gzip ${Math.round(gzipSync(json).length / 1024)} КБ; сборка на сервере ${Math.round(buildMs)} мс, разбор и индекс в браузере ${Math.round(clientMs)} мс`);

const g = createGeocoder(data);
const rows = readFileSync(resolve(ROOT, "data/geocoder/research/eval/out/queries.v1big.train.jsonl"), "utf8").split("\n").filter(Boolean)
  .map((l) => JSON.parse(l) as { query: string });
let n = 0;
let same1 = 0;
let same5 = 0;
const ms: number[] = [];
for (const r of rows) {
  for (let k = 1; k <= r.query.length; k++) {
    const p = r.query.slice(0, k);
    if (/\d/.test(p)) break;
    t = performance.now();
    const a = cg.suggest(p).map((h) => `${h.title}|${h.subtitle}`);
    ms.push(performance.now() - t);
    const b = g.suggest(p).map((h) => `${h.title}|${h.subtitle}`);
    n++;
    if (a[0] === b[0]) same1++;
    if (a.join("\n") === b.join("\n")) same5++;
    else if (args.includes("--show")) console.log(`«${p}»\n  клиент: ${a.join(" · ")}\n  сервер: ${b.join(" · ")}`);
  }
}
ms.sort((x, y) => x - y);
console.log(`префиксов без номера ${n}: первая подсказка как на сервере ${((same1 / n) * 100).toFixed(1)}%, пятёрка целиком ${((same5 / n) * 100).toFixed(1)}%; `
  + `подсказка по мини-индексу p50 ${ms[ms.length >> 1].toFixed(2)} мс, p95 ${ms[Math.floor(ms.length * 0.95)].toFixed(2)} мс, макс ${ms[ms.length - 1].toFixed(1)} мс`);
