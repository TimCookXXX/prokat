// Полный индекс (index.krasnodar.json, OSM + ГАР) без отложенного замера — для честного замера на нём.
// Отложенный дом: убираются все записи с тем же ключом номера не дальше 300 м от точки OSM (и OSM, и ГАР).
// Отложенная улица: убираются улицы с тем же ядром названия, чья точка или дома не дальше 500 м от её домов.
//
//   pnpm exec tsx scripts/geocoder-eval/filter-holdout.ts [--in data/geocoder/build/index.krasnodar.json]
//        [--out data/geocoder/build/index.krasnodar.eval.json] [--extra-holdout data/geocoder/search-eval/holdout.train.json]

import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { houseKey } from "@/lib/geocoder/house-number";
import { haversineKm } from "@/lib/geocoder/index-build";
import type { GeoIndexData } from "@/lib/geocoder/types";

const ROOT = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const opt = (name: string, def: string | null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

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
  return out.join(" ") || name.toLowerCase();
}

interface Addr { osm: string; street: string; hn: string; lat: number; lon: number; settlement: string }

async function main() {
  const inPath = resolve(ROOT, opt("--in", "data/geocoder/build/index.krasnodar.json")!);
  const outPath = resolve(ROOT, opt("--out", "data/geocoder/build/index.krasnodar.eval.json")!);
  const data = JSON.parse(readFileSync(inPath, "utf8")) as GeoIndexData;
  const holds = [JSON.parse(readFileSync(resolve(ROOT, "data/geocoder/research/eval/out/holdout.json"), "utf8"))];
  const extra = opt("--extra-holdout", null);
  if (extra) holds.push(JSON.parse(readFileSync(resolve(ROOT, extra), "utf8")));
  const heldHouses = new Set<string>(holds.flatMap((h) => h.houses as string[]));
  const heldStreets = new Set<string>(holds.flatMap((h) => (h.streets as { settlement: string; core: string }[]).map((s) => `${s.settlement}|${s.core}`)));

  const houseDrop: Addr[] = [];
  const streetPts = new Map<string, { lat: number; lon: number }[]>(); // ядро → точки отложенных улиц
  const rl = createInterface({ input: createReadStream(resolve(ROOT, "data/geocoder/research/eval/out/addresses.jsonl")), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const a = JSON.parse(line) as Addr;
    const c = core(a.street);
    if (heldHouses.has(a.osm)) houseDrop.push(a);
    if (heldStreets.has(`${a.settlement}|${c}`)) {
      let arr = streetPts.get(c);
      if (!arr) streetPts.set(c, (arr = []));
      arr.push({ lat: a.lat, lon: a.lon });
    }
  }
  // улицы индекса: отложенные — по ядру и близости
  const houseByStreet = new Map<string, { lat: number; lon: number }[]>();
  for (const h of data.houses) {
    if (!h.streetId) continue;
    let arr = houseByStreet.get(h.streetId);
    if (!arr) houseByStreet.set(h.streetId, (arr = []));
    arr.push(h);
  }
  const dropStreet = new Set<string>();
  for (const s of data.streets) {
    const pts = streetPts.get(core(s.name));
    if (!pts) continue;
    const own = [s, ...(houseByStreet.get(s.id) ?? []).filter((h, i) => i % 5 === 0)];
    if (own.some((p) => pts.some((q) => haversineKm(p, q) <= 0.5))) dropStreet.add(s.id);
  }
  // дома: отложенные по ключу номера и близости (сетка ~1 км)
  const grid = new Map<string, Addr[]>();
  const cell = (lat: number, lon: number) => `${Math.round(lat * 100)}|${Math.round(lon * 70)}`;
  for (const a of houseDrop) {
    const k = cell(a.lat, a.lon);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(a);
  }
  let droppedHouses = 0;
  const streetCore = new Map(data.streets.map((s) => [s.id, core(s.name)]));
  const houses = data.houses.filter((h) => {
    if (h.streetId && dropStreet.has(h.streetId)) {
      droppedHouses++;
      return false;
    }
    const key = houseKey(h.number);
    const hc = h.streetId ? streetCore.get(h.streetId) : null;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const arr = grid.get(`${Math.round(h.lat * 100) + di}|${Math.round(h.lon * 70) + dj}`);
        if (arr?.some((a) => houseKey(a.hn) === key && (!hc || core(a.street) === hc) && haversineKm(a, h) <= 0.3)) {
          droppedHouses++;
          return false;
        }
      }
    }
    return true;
  });
  const streets = data.streets.filter((s) => !dropStreet.has(s.id));
  const pois = (data.pois ?? []).filter((p) => !houseDrop.some((a) => haversineKm(a, p) <= 0.03));
  writeFileSync(outPath, JSON.stringify({ ...data, version: `${data.version}-eval`, streets, houses, pois }));
  console.log(`${outPath}: улиц убрано ${dropStreet.size}, домов убрано ${droppedHouses} (${houses.length} осталось)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
