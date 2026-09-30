// Ручная проверка подсказок: pnpm exec tsx scripts/geocoder-eval/try.ts [--index путь] "запрос" …
// Без запросов в аргументах — читает их из stdin построчно.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGeocoder } from "@/lib/geocoder";
import type { GeoIndexData } from "@/lib/geocoder/types";

const args = process.argv.slice(2);
let indexPath = resolve(import.meta.dirname, "../../data/geocoder/build/index.krasnodar.json");
const i = args.indexOf("--index");
if (i >= 0) {
  indexPath = resolve(args[i + 1]);
  args.splice(i, 2);
}
let t = performance.now();
const data = JSON.parse(readFileSync(indexPath, "utf8")) as GeoIndexData;
const g = createGeocoder(data);
console.log(`индекс ${indexPath}: ${Math.round(performance.now() - t)} мс`, g.stats());
const queries = args.length ? args : readFileSync(0, "utf8").split("\n").filter(Boolean);
for (const q of queries) {
  t = performance.now();
  const hits = g.suggest(q);
  const ms = performance.now() - t;
  const one = g.geocode(q);
  console.log(`\n«${q}» — ${ms.toFixed(1)} мс`);
  for (const h of hits) console.log(`  ${h.score.toFixed(1).padStart(6)}  ${h.kind.padEnd(6)} ${h.precision.padEnd(12)} ${h.title} — ${h.subtitle}  (${h.lat.toFixed(5)}, ${h.lon.toFixed(5)})`);
  console.log(`  geocode: ${one ? `${one.title} — ${one.subtitle} [${one.precision}] (${one.lat.toFixed(5)}, ${one.lon.toFixed(5)})` : "null"}`);
}
