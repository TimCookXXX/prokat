// HTTP-обёртка геокодера для оценщика разведки (data/geocoder/research/eval/evaluate.py --http):
//   GET /suggest?q=&k=5[&near=lat,lon] → [{settlement, street, hn, lat, lon, level, score}] (near по умолчанию — центр Краснодара)
//   GET /geocode?q=     → {…} | null
//   GET /geocode-detailed?q= → { hit, reason, message, alternatives } (для глаз)
//   GET /reverse?lat=&lon=   → AddressHit | null (для глаз)
// Индекс — БЕЗ отложенного (holdout), иначе замер координат нечестный.
//
//   pnpm exec tsx scripts/geocoder-eval/serve.ts [--index data/geocoder/build/dev-index.eval.json] [--port 8765]

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGeocoder } from "@/lib/geocoder";
import type { AddressHit, GeoIndexData } from "@/lib/geocoder/types";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const indexPath = resolve(opt("--index", "data/geocoder/build/dev-index.eval.json"));
const port = Number(opt("--port", "8765"));
// Центр Краснодара — как сайт передаёт near, когда место пользователя неизвестно.
const near = { lat: 45.0355, lon: 38.9753 };

const t = performance.now();
const g = createGeocoder(JSON.parse(readFileSync(indexPath, "utf8")) as GeoIndexData);
global.gc?.();
const mem = process.memoryUsage();
console.error(`индекс ${indexPath}: ${Math.round(performance.now() - t)} мс, heap ${Math.round(mem.heapUsed / 1e6)} МБ, rss ${Math.round(mem.rss / 1e6)} МБ`, g.stats());

function out(h: AddressHit | null) {
  if (!h) return null;
  return {
    settlement: h.parts?.place ?? h.subtitle, street: h.parts?.street ?? null, hn: h.parts?.house ?? null,
    lat: h.lat, lon: h.lon, level: h.precision === "place" ? "settlement" : h.precision, score: h.score, title: h.title,
  };
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const q = url.searchParams.get("q") ?? "";
  const nearQ = url.searchParams.get("near")?.split(",").map(Number);
  const at = nearQ && nearQ.length === 2 && nearQ.every(Number.isFinite) ? { lat: nearQ[0], lon: nearQ[1] } : near;
  let body: unknown = null;
  if (url.pathname === "/suggest") body = g.suggest(q, { limit: Number(url.searchParams.get("k") ?? 5), near: at }).map(out);
  else if (url.pathname === "/geocode") body = out(g.geocode(q, { near }));
  else if (url.pathname === "/geocode-detailed") body = g.geocodeDetailed(q, { near });
  else if (url.pathname === "/reverse") body = g.reverse(Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon")));
  else {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}).listen(port, "127.0.0.1", () => console.error(`http://127.0.0.1:${port}`));
