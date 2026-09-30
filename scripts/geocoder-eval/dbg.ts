// Отладка ранжирования: pnpm exec tsx scripts/geocoder-eval/dbg.ts "запрос" … — слова запроса и первые 12 кандидатов
// с покрытием, лишними словами и ключом.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QueryToken } from "@/lib/geocoder/query";
// ENG=<копия src/lib/geocoder> — другой движок, IDX=<файл в data/geocoder/build> — другой индекс
const { Engine } = await import(process.env.ENG ? process.env.ENG + "/engine.ts" : "@/lib/geocoder/engine");
const { buildIndex } = await import(process.env.ENG ? process.env.ENG + "/index-build.ts" : "@/lib/geocoder/index-build");
import type { GeoIndexData } from "@/lib/geocoder/types";

const ix = buildIndex(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../data/geocoder/build/" + (process.env.IDX ?? "index.krasnodar.json") + ""), "utf8")) as GeoIndexData);
const e = new Engine(ix);
for (const q of process.argv.slice(2)) {
  console.log(`\n«${q}»`, JSON.stringify(e.analyze(q).map((t: QueryToken) => `${t.kind}:${t.text}${t.fn ? "/" + t.fn : ""}${t.prefix ? "*" : ""}${t.abbr ? "." : ""}${t.houseAlts ? "[" + t.houseAlts.join(",") + "]" : ""}`)));
  for (const s of e.rank(q, null, "suggest").slice(0, 12)) {
    console.log(`  ${s.score.toFixed(1).padStart(6)} text ${s.text.toFixed(2)} lo ${s.leftover} ${s.hit.kind}/${s.hit.precision} ${s.hit.title} — ${s.hit.subtitle}${s.placeOk !== null ? " placeOk=" + s.placeOk : ""}`);
  }
  console.log("  geocode:", JSON.stringify(((g) => ({ r: g.reason, t: g.hit?.title, s: g.hit?.subtitle }))(e.geocodeDetailed(q))));
}
