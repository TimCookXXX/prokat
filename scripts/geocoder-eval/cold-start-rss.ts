// Память геокодера по боевому пути после загрузки и «под трафиком»: запросы идут каждые 100 мс (соединения
// пула не простаивают), RSS и куча — сразу, через 15 и 60 с.
//   node --expose-gc --env-file=.env --import tsx scripts/geocoder-eval/cold-start-rss.ts
import { getPool } from "@/lib/db";
import { suggestAddresses } from "@/server/geocoder";

const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const mb = (n: number) => Math.round(n / 1e6);
gc();
const m0 = process.memoryUsage();
await suggestAddresses("красная 120", "krasnodar", { limit: 5 });
const snap = (label: string) => {
  gc();
  const m = process.memoryUsage();
  console.log(JSON.stringify({ at: label, heapTotalMb: mb(m.heapTotal), extMb: mb(m.external), abMb: mb(m.arrayBuffers), heapMb: mb(m.heapUsed), heapDeltaMb: mb(m.heapUsed - m0.heapUsed), rssMb: mb(m.rss), rssDeltaMb: mb(m.rss - m0.rss) }));
};
snap("loaded");
// «трафик»: подсказки и запрос к БД через тот же пул каждые 100 мс
const t = setInterval(() => {
  void suggestAddresses("ставропольская 1", "krasnodar", { limit: 5 });
  void getPool().query("select 1");
}, 100);
await new Promise((r) => setTimeout(r, 145_000));
snap("15s");
await new Promise((r) => setTimeout(r, 45_000));
snap("60s");
clearInterval(t);
process.exit(0);
