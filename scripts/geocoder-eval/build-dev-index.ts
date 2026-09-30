// Временный индекс геокодера из выгрузки OSM разведки (data/geocoder/research/eval/out) — пока команда
// данных собирает полный index.krasnodar.json (OSM + ГАР). Пишет два файла:
//   data/geocoder/build/dev-index.json       — всё;
//   data/geocoder/build/dev-index.eval.json  — без отложенных домов и улиц (holdout.json): только для замера.
//
//   pnpm exec tsx scripts/geocoder-eval/build-dev-index.ts

import { createReadStream, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { CITY_GEO } from "@/lib/compare/geo-data";
import type { GeoIndexData, IndexHouse, IndexPlace, IndexPoi, IndexStreet, PlaceKind } from "@/lib/geocoder/types";

const ROOT = resolve(import.meta.dirname, "../..");
const EVAL = resolve(ROOT, "data/geocoder/research/eval/out");
const OUT = resolve(ROOT, "data/geocoder/build");

interface Addr {
  osm: string; street: string; street_is_place: boolean; hn: string; lon: number; lat: number;
  poi: boolean; name: string | null; settlement: string; settlement_src: string; district: string | null;
}
interface StreetLine { settlement: string; name: string; pts: [number, number][] }
interface PlaceNode { name: string; place: string; lon: number; lat: number }

async function readJsonl<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) out.push(JSON.parse(line) as T);
  return out;
}

// Ядро улицы — как geotext.street_parts в замере (для отложенных улиц).
const TYPES = new Set(["улица", "проспект", "переулок", "проезд", "бульвар", "площадь", "шоссе", "набережная", "микрорайон", "тупик", "аллея", "квартал", "территория"]);
function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я/]+/g, " ").replace(/\s+/g, " ").trim();
}
function streetCore(name: string): string {
  let typ: string | null = null;
  const core: string[] = [];
  for (const w of norm(name).split(" ")) {
    if (TYPES.has(w) && typ === null) {
      typ = w;
      continue;
    }
    if (w === "имени" || w === "им") continue;
    core.push(w);
  }
  return core.join(" ") || norm(name);
}
const TYPE_WORDS = ["улица", "проспект", "переулок", "проезд", "бульвар", "площадь", "шоссе", "набережная", "микрорайон", "тупик", "аллея", "квартал", "территория", "линия", "дорога", "километр", "сквер"];
/** Тип улицы из названия OSM: «улица Набережная» и «Набережная улица» — улица; «Рождественская набережная» — набережная. */
function streetType(name: string): string {
  const ws = name.toLowerCase().replace(/ё/g, "е").split(/\s+/);
  const first = ws[0];
  const last = ws[ws.length - 1];
  if (ws.length > 1 && (first === "улица" || last === "улица")) return "улица";
  if (ws.length > 1 && TYPE_WORDS.includes(last) && last !== "линия") return last;
  if (ws.length > 1 && TYPE_WORDS.includes(first) && first !== "линия") return first;
  return "";
}

function sntLike(name: string): boolean {
  return /(^|[\s«"])(снт|нст|днт|сот|тсн|ст|сдт|нсо|кп|онт)([\s»"]|$)|садов|товарищ/i.test(name);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

async function main() {
  const addrs = await readJsonl<Addr>(resolve(EVAL, "addresses.jsonl"));
  const lines = await readJsonl<StreetLine>(resolve(EVAL, "streets.jsonl"));
  const nodes = await readJsonl<PlaceNode>(resolve(EVAL, "places.jsonl"));
  const hold = JSON.parse(readFileSync(resolve(EVAL, "holdout.json"), "utf8")) as { houses: string[]; streets: { settlement: string; core: string }[] };
  const heldHouses = new Set(hold.houses);
  const heldStreets = new Set(hold.streets.map((s) => `${s.settlement}|${s.core}`));
  // --extra-holdout <json> — ещё отложенное (из train, gen_train_holdout.py): пишется dev-index.evaltrain.json
  const xi = process.argv.indexOf("--extra-holdout");
  const extra = xi >= 0 ? (JSON.parse(readFileSync(resolve(process.argv[xi + 1]), "utf8")) as typeof hold) : null;
  if (extra) {
    for (const h of extra.houses) heldHouses.add(h);
    for (const s of extra.streets) heldStreets.add(`${s.settlement}|${s.core}`);
  }

  for (const variant of extra ? (["eval"] as const) : (["full", "eval"] as const)) {
    const skipHouse = (a: Addr) => variant === "eval" && (heldHouses.has(a.osm) || heldStreets.has(`${a.settlement}|${streetCore(a.street)}`));
    const skipStreet = (settlement: string, name: string) => variant === "eval" && heldStreets.has(`${settlement}|${streetCore(name)}`);

    // --- пункты
    const places: IndexPlace[] = [];
    const placeId = new Map<string, string>();
    const nodeByName = new Map<string, PlaceNode>();
    for (const n of nodes) if (!nodeByName.has(n.name) || n.place === "city" || n.place === "town") nodeByName.set(n.name, n);
    const settlPts = new Map<string, { lat: number[]; lon: number[] }>();
    for (const a of addrs) {
      let s = settlPts.get(a.settlement);
      if (!s) settlPts.set(a.settlement, (s = { lat: [], lon: [] }));
      s.lat.push(a.lat);
      s.lon.push(a.lon);
    }
    const kindOf = (name: string): PlaceKind => {
      if (sntLike(name)) return "snt";
      const tag = nodeByName.get(name)?.place;
      if (tag === "city") return "city";
      if (tag === "town") return "town";
      if (tag === "hamlet" || tag === "isolated_dwelling") return "hamlet";
      if (tag === "neighbourhood" || tag === "suburb" || tag === "quarter") return "microdistrict";
      return "village";
    };
    let pn = 0;
    for (const [name, pts] of settlPts) {
      const node = nodeByName.get(name);
      const kind = kindOf(name);
      const id = `pl-${++pn}`;
      placeId.set(name, id);
      const aliases: string[] = [];
      if (kind === "town") aliases.push(`пгт ${name}`, `посёлок ${name}`);
      places.push({
        id, name, kind: name === "Краснодар" ? "city" : kind, aliases, parentId: null,
        lat: node?.lat ?? median(pts.lat), lon: node?.lon ?? median(pts.lon),
      });
    }
    const krd = placeId.get("Краснодар")!;
    // Округа и микрорайоны Краснодара — из справочника сайта (синонимы «ЮМР», «ФМР»)
    const okrugId = new Map<string, string>();
    for (const city of CITY_GEO) {
      for (const o of city.okrugs) {
        const id = `pl-${++pn}`;
        okrugId.set(o.slug, id);
        places.push({ id, name: o.name, kind: "okrug", aliases: o.aliases, parentId: krd, lat: o.lat, lon: o.lon });
      }
      for (const m of city.microdistricts) {
        const id = `pl-${++pn}`;
        placeId.set(`md:${m.name}`, id);
        places.push({ id, name: m.name, kind: "microdistrict", aliases: m.aliases, parentId: okrugId.get(m.okrug) ?? krd, lat: m.lat, lon: m.lon });
      }
    }
    // Районы/СНТ внутри пунктов (поле district выгрузки): «Пашковский», «СНТ «Труд»»
    const distPts = new Map<string, { settl: string; lat: number[]; lon: number[] }>();
    for (const a of addrs) {
      if (!a.district || a.district === a.settlement) continue;
      const k = `${a.settlement}|${a.district}`;
      let d = distPts.get(k);
      if (!d) distPts.set(k, (d = { settl: a.settlement, lat: [], lon: [] }));
      d.lat.push(a.lat);
      d.lon.push(a.lon);
    }
    const districtId = new Map<string, string>();
    for (const [k, d] of distPts) {
      const name = k.split("|")[1];
      const existing = placeId.get(`md:${name}`);
      if (existing && d.settl === "Краснодар") {
        districtId.set(k, existing);
        continue;
      }
      const id = `pl-${++pn}`;
      districtId.set(k, id);
      places.push({
        id, name, kind: sntLike(name) ? "snt" : "microdistrict", aliases: [], parentId: placeId.get(d.settl) ?? null,
        lat: median(d.lat), lon: median(d.lon),
      });
    }

    // --- улицы и дома
    const streets: IndexStreet[] = [];
    const streetId = new Map<string, IndexStreet>();
    const houses: IndexHouse[] = [];
    const pois: IndexPoi[] = [];
    const byStreet = new Map<string, Addr[]>();
    for (const a of addrs) {
      if (skipHouse(a)) continue;
      const k = `${a.settlement}|${a.street}`;
      let arr = byStreet.get(k);
      if (!arr) byStreet.set(k, (arr = []));
      arr.push(a);
    }
    let sn = 0;
    const addStreet = (settlement: string, name: string, pts: { lat: number; lon: number }[]) => {
      const mlat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const mlon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
      let best = pts[0];
      let bd = Infinity;
      for (const p of pts) {
        const d = (p.lat - mlat) ** 2 + ((p.lon - mlon) * 0.7) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      const st: IndexStreet = {
        id: `st-${++sn}`, placeId: placeId.get(settlement) ?? null, name, type: streetType(name), aliases: [],
        lat: best.lat, lon: best.lon, houses: 0,
      };
      streets.push(st);
      streetId.set(`${settlement}|${name}`, st);
      return st;
    };
    for (const [k, arr] of byStreet) {
      const [settlement, name] = k.split("|");
      const st = addStreet(settlement, name, arr);
      st.houses = arr.length;
      for (const a of arr) {
        const dist = a.district && a.district !== a.settlement ? districtId.get(`${a.settlement}|${a.district}`) : undefined;
        houses.push({
          streetId: st.id, placeId: dist ?? placeId.get(a.settlement) ?? null, number: a.hn, lat: a.lat, lon: a.lon,
          precision: "house", source: "osm", postcode: null,
        });
        if (a.poi && a.name) {
          pois.push({
            id: `poi-${pois.length + 1}`, name: a.name, kind: "poi", aliases: [], placeId: placeId.get(a.settlement) ?? null,
            lat: a.lat, lon: a.lon, address: `${name}, ${a.hn}`,
          });
        }
      }
    }
    for (const l of lines) {
      if (!l.name || streetId.has(`${l.settlement}|${l.name}`) || skipStreet(l.settlement, l.name) || !placeId.has(l.settlement)) continue;
      if (!l.pts.length) continue;
      addStreet(l.settlement, l.name, l.pts.map(([lon, lat]) => ({ lat, lon })));
    }

    const data: GeoIndexData = {
      version: `osm-dev-${variant}`, citySlug: "krasnodar", builtAt: new Date().toISOString(), places, streets, houses, pois,
    };
    mkdirSync(OUT, { recursive: true });
    const file = resolve(OUT, variant === "full" ? "dev-index.json" : extra ? "dev-index.evaltrain.json" : "dev-index.eval.json");
    writeFileSync(file, JSON.stringify(data));
    console.log(`${file}: places ${places.length}, streets ${streets.length}, houses ${houses.length}, pois ${pois.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
