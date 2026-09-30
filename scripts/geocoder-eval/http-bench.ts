// Скорость /api/geo/suggest через HTTP (Next): первый запрос после старта процесса и тёплые p50/p95.
// Запросы — val целиком + набор по буквам (каждый префикс) 150 запросов; near — центр Краснодара.
// Лимит частоты обходится разными X-Forwarded-For (только для замера).
//   pnpm exec tsx scripts/geocoder-eval/http-bench.ts [--base http://127.0.0.1:3100]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:3100";
const ROOT = resolve(import.meta.dirname, "../..");
const qs = readFileSync(resolve(ROOT, "data/geocoder/research/eval/out/queries.v1big.val.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { query: string }).query);
const typing: string[] = [];
for (const q of qs.slice(0, 150)) for (let n = 1; n <= q.length; n++) typing.push(q.slice(0, n));
let ip = 0;
async function one(q: string): Promise<number> {
  const t = performance.now();
  const r = await fetch(`${base}/api/geo/suggest?city=krasnodar&near=45.0355,38.9753&q=${encodeURIComponent(q)}`,
    { headers: { "x-forwarded-for": `10.0.${(ip >> 8) & 255}.${ip++ & 255}` } });
  if (!r.ok) throw new Error(`${r.status} ${q}`);
  const j = (await r.json()) as { items: { lat?: number }[] };
  if (j.items.length && typeof j.items[0].lat !== "number") throw new Error("нет координат в подсказке");
  return performance.now() - t;
}
const first = await one("красная 120");
console.log(`первый запрос: ${Math.round(first)} мс`);
for (let i = 0; i < 20; i++) await one(`прогрев ${i}`);
function stat(name: string, ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const p = (x: number) => s[Math.min(s.length - 1, Math.floor(s.length * x))].toFixed(1);
  console.log(`${name}: n=${s.length} p50 ${p(0.5)} мс, p95 ${p(0.95)}, p99 ${p(0.99)}, макс ${s[s.length - 1].toFixed(1)}`);
}
const a: number[] = [];
for (const q of qs) a.push(await one(q));
stat("HTTP suggest, полные запросы (val)", a);
const b: number[] = [];
for (const q of typing) b.push(await one(q));
stat("HTTP suggest, набор по буквам", b);
