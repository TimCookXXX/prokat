// Скорость и память геокодера на полном индексе.
//   node --expose-gc --import tsx scripts/geocoder-eval/bench.ts [--index data/geocoder/build/index.krasnodar.json]
// Запросы: train-набор замера целиком + «набор по буквам» (каждый префикс) для 300 запросов.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGeocoder } from "@/lib/geocoder";
import type { GeoIndexData } from "@/lib/geocoder/types";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const ROOT = resolve(import.meta.dirname, "../..");
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const mb = (n: number) => `${Math.round(n / 1e6)} МБ`;

gc();
const heap0 = process.memoryUsage().heapUsed;
let t = performance.now();
let raw: string | null = readFileSync(resolve(ROOT, opt("--index", "data/geocoder/build/index.krasnodar.json")), "utf8");
let data: GeoIndexData | null = JSON.parse(raw) as GeoIndexData;
raw = null;
const tParse = performance.now() - t;
gc();
const heapData = process.memoryUsage().heapUsed;
t = performance.now();
const g = createGeocoder(data);
const tBuild = performance.now() - t;
data = null;
gc();
const heapIndex = process.memoryUsage().heapUsed;
console.log(`разбор JSON ${Math.round(tParse)} мс, сборка индекса ${Math.round(tBuild)} мс`, g.stats());
console.log(`память: данные JSON ${mb(heapData - heap0)}, индекс после освобождения данных ${mb(heapIndex - heap0)}, rss ${mb(process.memoryUsage().rss)}`);

const queries = readFileSync(resolve(ROOT, "data/geocoder/research/eval/out/queries.v1big.train.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { query: string }).query);
const typing: string[] = [];
for (const q of queries.slice(0, 300)) for (let n = 1; n <= q.length; n++) typing.push(q.slice(0, n));

const near = { lat: 45.0355, lon: 38.9753 };
function measure(name: string, list: string[], fn: (q: string) => unknown) {
  const ms: number[] = [];
  for (const q of list) {
    const s = performance.now();
    fn(q);
    ms.push(performance.now() - s);
  }
  ms.sort((a, b) => a - b);
  const p = (x: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * x))].toFixed(2);
  console.log(`${name}: n=${ms.length} p50 ${p(0.5)} мс, p95 ${p(0.95)}, p99 ${p(0.99)}, макс ${ms[ms.length - 1].toFixed(1)}`);
}
measure("suggest, холодный кэш слов (полные запросы)", queries, (q) => g.suggest(q, { near }));
measure("suggest, тёплый (повтор)", queries, (q) => g.suggest(q, { near }));
measure("suggest, набор по буквам", typing, (q) => g.suggest(q, { near }));
measure("geocode", queries, (q) => g.geocode(q, { near }));
gc();
const heapBeforeGrid = process.memoryUsage().heapUsed;
t = performance.now();
g.reverse(near.lat, near.lon); // первая точка строит сетку домов
console.log(`reverse: сетка ${Math.round(performance.now() - t)} мс`);
gc();
console.log(`reverse: память сетки ${mb(process.memoryUsage().heapUsed - heapBeforeGrid)}`);
// точки — случайные в пределах агломерации (детерминированно)
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const points = Array.from({ length: 3000 }, () => `${44.9 + rnd() * 0.35},${38.75 + rnd() * 0.5}`);
measure("reverse", points, (s) => {
  const [la, lo] = s.split(",").map(Number);
  g.reverse(la, lo);
});
gc();
console.log(`память после запросов: heap ${mb(process.memoryUsage().heapUsed - heap0)}, rss ${mb(process.memoryUsage().rss)}`);
