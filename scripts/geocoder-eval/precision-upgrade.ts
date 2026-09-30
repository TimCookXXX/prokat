// Сколько домов ГАР с точностью данных «≈» (precision street) движок выдаёт как «до дома» (interpolated/house):
// каждый 4-й такой дом, запрос «<улица> <номер>» с near = точка дома, ищется хит этого дома в топ-10.
//   pnpm exec tsx scripts/geocoder-eval/precision-upgrade.ts
import { readFileSync } from "node:fs";
import { createGeocoder } from "@/lib/geocoder";
import { houseKey } from "@/lib/geocoder/house-number";
import type { GeoIndexData } from "@/lib/geocoder/types";
const data = JSON.parse(readFileSync("data/geocoder/build/index.krasnodar.json", "utf8")) as GeoIndexData;
const krd = data.places.find((p) => p.kind === "city")!.id;
const parent = new Map(data.places.map((p) => [p.id, p.parentId]));
const inCity = (pid: string | null) => { // сам город, его округа и микрорайоны (не посёлки в черте)
  let p = pid; let k = 0;
  while (p && k++ < 5) { if (p === krd) return true; const pl = data.places.find((x) => x.id === p); if (pl && !["microdistrict", "okrug"].includes(pl.kind)) return false; p = parent.get(p) ?? null; }
  return false;
};
const streets = new Map(data.streets.map((s) => [s.id, s]));
const sample = data.houses.filter((h) => h.streetId && (h.precision === "street") && h.source !== "osm");
const g = createGeocoder(data);
const out = { n: 0, found: 0, house: 0, interpolated: 0, street: 0, place: 0, krdN: 0, krdInterp: 0 };
let i = 0;
for (const h of sample) {
  if (i++ % 4) continue; // каждый 4-й
  const st = streets.get(h.streetId!)!;
  const hits = g.suggest(`${st.name} ${h.number}`, { near: { lat: h.lat, lon: h.lon }, limit: 10 });
  const id = `h:${st.id}:${houseKey(h.number)}`;
  const hit = hits.find((x) => x.id === id);
  out.n++;
  const city = inCity(st.placeId);
  if (city) out.krdN++;
  if (!hit) continue;
  out.found++;
  (out as Record<string, number>)[hit.precision]++;
  if (city && hit.precision === "interpolated") out.krdInterp++;
}
console.log(JSON.stringify(out));
