// «Тип + название» для всех посёлков, станиц, хуторов индекса («ст-ца Елизаветинская», «х. Ленина», «п. Российский»):
// пункт должен быть первым, а не одноимённая улица. Запросы — из синонимов пунктов с типом и их коротких форм.
//   pnpm exec tsx scripts/geocoder-eval/place-types.ts [--engine <копия src/lib/geocoder>] [--index …] [--show]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressHit, GeoIndexData } from "@/lib/geocoder/types";

const ROOT = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const mod = await import(resolve(opt("--engine", resolve(ROOT, "src/lib/geocoder")), "engine.ts"));
const data = JSON.parse(readFileSync(resolve(ROOT, opt("--index", "data/geocoder/build/index.krasnodar.json")), "utf8")) as GeoIndexData;
const g = mod.createGeocoder(data) as { suggest(q: string): AddressHit[] };

const SHORT: Record<string, string[]> = {
  станица: ["ст.", "ст-ца"], поселок: ["п.", "пос."], посёлок: ["п.", "пос."], хутор: ["х.", "хут."], пгт: ["пгт"], аул: ["а."], село: ["с."],
};
const line = (hits: AddressHit[]) => hits.slice(0, 2).map((h) => `${h.title} — ${h.subtitle}`).join(" | ");

let n = 0;
let ok1 = 0;
let ok5 = 0;
for (const p of data.places) {
  if (!["town", "village", "hamlet"].includes(p.kind)) continue;
  const qs = new Set<string>();
  for (const a of p.aliases) {
    const m = /^(станица|поселок|посёлок|хутор|пгт|аул|село)\s+(.+)$/i.exec(a);
    if (!m) continue;
    qs.add(a);
    for (const s of SHORT[m[1].toLowerCase()] ?? []) qs.add(`${s} ${m[2]}`);
  }
  for (const q of qs) {
    const hits = g.suggest(q);
    const i = hits.findIndex((h) => h.kind === "place" && h.id === `p:${p.id}`);
    n++;
    if (i === 0) ok1++;
    if (i >= 0 && i < 5) ok5++;
    if (i !== 0 && args.includes("--show")) console.log(`«${q}» (${i}) → ${line(hits)}`);
  }
}
console.log(`тип + пункт: n=${n}, топ-1 ${((ok1 / n) * 100).toFixed(1)}%, топ-5 ${((ok5 / n) * 100).toFixed(1)}%`);
