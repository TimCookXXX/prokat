// Холодный старт геокодера по боевому пути сервера: БД (geo_*) → GeoIndexData → движок + мини-индекс → первая подсказка.
// Свежий процесс, память — heap/rss до и после.
//   node --expose-gc --env-file=.env --import tsx scripts/geocoder-eval/cold-start.ts
import { getCityGeocoder, suggestAddresses } from "@/server/geocoder";
import { getGeoIndexData } from "@/server/geocoder-index";

const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const mb = (n: number) => `${Math.round(n / 1e6)} МБ`;
gc();
const m0 = process.memoryUsage();
const t0 = performance.now();
await getGeoIndexData("krasnodar");
const tData = performance.now() - t0;
gc();
const mData = process.memoryUsage();
const t1 = performance.now();
const eng = await getCityGeocoder("krasnodar");
const tEngine = performance.now() - t1;
const t2 = performance.now();
const items = await suggestAddresses("красная 120", "krasnodar", { limit: 5 });
const tFirst = performance.now() - t2;
gc();
const m1 = process.memoryUsage();
console.log(JSON.stringify({
  dataFromDbMs: Math.round(tData), engineAndClientIndexMs: Math.round(tEngine), firstSuggestMs: +tFirst.toFixed(2),
  totalColdMs: Math.round(performance.now() - t0), firstHit: items[0]?.title, clientIndexKb: Math.round((eng?.clientJson.length ?? 0) / 1024),
  heapData: mb(mData.heapUsed - m0.heapUsed), heapDelta: mb(m1.heapUsed - m0.heapUsed), rss: mb(m1.rss), rssDelta: mb(m1.rss - m0.rss),
}));
process.exit(0);
