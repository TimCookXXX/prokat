// Тёзки на полном индексе (классы раунда 4 цикла качества), по всем подходящим улицам Краснодара:
//  1. проезд / переулок / бульвар с улицей-тёзкой: «Краснодар, проезд X, д. N» и без «д.» — топ-1 и geocode;
//  2. тёзки внутри города с одним номером и разными почтовыми индексами: с индексом и без;
//  3. «Краснодар, <микрорайон>, ул. X, N» — тёзка в названном микрорайоне.
//   pnpm exec tsx scripts/geocoder-eval/twins.ts            (ENG=<копия src/lib/geocoder> — «было»; V=1, V2=1, V3=1 — примеры)
// «Чужой» — geocode уверенно дал дом дальше 50 м от цели.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const ENG = process.env.ENG ?? resolve(import.meta.dirname, "../../src/lib/geocoder");
const { Engine } = await import(ENG + "/engine.ts");
const { buildIndex: buildE } = await import(ENG + "/index-build.ts");
const { buildIndex, haversineKm } = await import("@/lib/geocoder/index-build");
const data = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../data/geocoder/build/index.krasnodar.json"), "utf8"));
const ix = buildIndex(data);
const e = new Engine(buildE(data));
const eN = new (await import("@/lib/geocoder/engine")).Engine(ix);
const krd = ix.cityPlace;
const root = (p: number) => eN.rootSettlement(p);
const byCore = new Map<string, number[]>();
ix.streets.forEach((st: any) => {
  if (!st.core || root(st.area) !== krd) return;
  (byCore.get(st.core) ?? byCore.set(st.core, []).get(st.core)!).push(st.idx);
});
const houseOf = (st: any, prec = 0) => { for (let j = st.start; j < st.end; j++) if (ix.hPrec[j] <= prec && /^\d+$/.test(ix.hKey[j])) return j; return -1; };
const TYPE_ABBR: Record<string, string> = { "проезд": "проезд", "переулок": "переулок", "бульвар": "бульвар" };
// 1. проезд/переулок/бульвар с улицей-тёзкой: «Краснодар, <тип> X, д. N» и без «д.»
for (const withD of [true, false]) {
  let n = 0, top1 = 0, geoOk = 0, geoWrong = 0, geoNull = 0;
  for (const arr of byCore.values()) {
    const ul = arr.filter((i) => ix.streets[i].type === "улица");
    if (!ul.length) continue;
    for (const i of arr) {
      const st = ix.streets[i];
      if (!TYPE_ABBR[st.type]) continue;
      const j = houseOf(st);
      if (j < 0) continue;
      const nm = st.name.replace(new RegExp(`^${st.type} |\\s${st.type}$`), "");
      const q = `Краснодар, ${st.type} ${nm}, ${withD ? "д. " : ""}${ix.hRaw[j]}`;
      const target = { lat: ix.hLat[j], lon: ix.hLon[j] };
      const hits = e.suggest(q);
      const g = e.geocode(q);
      n++;
      if (hits[0] && hits[0].title.startsWith(st.name) && haversineKm(hits[0], target) < 0.05) top1++;
      if (!g) geoNull++;
      else if (haversineKm(g, target) < 0.05) geoOk++;
      else { geoWrong++; if (process.env.V) console.log("  wrong:", q, "→", g.title, Math.round(haversineKm(g, target) * 1000), "м"); }
    }
  }
  console.log(`тип-тёзка ${withD ? "с «д.»" : "без «д.»"}: n=${n} топ-1 ${top1} geocode верно ${geoOk}, чужой ${geoWrong}, отказ ${geoNull}`);
}
// 2. тёзки внутри Краснодара с одним номером и разными индексами: «PPPPPP, г. Краснодар, ул. X, д. N»
{
  let n = 0, ok = 0, wrong = 0, nul = 0, nulNoPc = 0, nNoPc = 0, wrongNoPc = 0;
  for (const arr of byCore.values()) {
    const ul = arr.filter((i) => ix.streets[i].type === "улица");
    if (ul.length < 2) continue;
    const keys = new Map<string, number[]>();
    for (const i of ul) { const st = ix.streets[i]; for (let j = st.start; j < st.end; j++) if (ix.hPrec[j] <= 1 && ix.hPost[j]) (keys.get(ix.hKey[j]) ?? keys.set(ix.hKey[j], []).get(ix.hKey[j])!).push(j); }
    for (const [k, js] of keys) {
      if (js.length < 2 || new Set(js.map((j) => ix.hPost[j])).size < js.length) continue;
      if (Math.min(...js.slice(1).map((j) => haversineKm({ lat: ix.hLat[j], lon: ix.hLon[j] }, { lat: ix.hLat[js[0]], lon: ix.hLon[js[0]] })) ) < 1) continue;
      for (const j of js.slice(0, 2)) {
        if (n >= 400) break;
        const st = ix.streets.find((s: any) => j >= s.start && j < s.end)!;
        const nm = st.name.replace(/^улица /, "");
        const target = { lat: ix.hLat[j], lon: ix.hLon[j] };
        const q = `${ix.hPost[j]}, г. Краснодар, ул. ${nm}, д. ${ix.hRaw[j]}`;
        const g = e.geocode(q);
        n++;
        if (!g) { nul++; if (process.env.V3) { const d = e.geocodeDetailed(q); console.log("  null pc:", q, d.reason, d.alternatives.map((h: any) => h.title + " — " + h.subtitle + " " + h.precision).join(" | ")); } } else if (haversineKm(g, target) < 0.05) ok++; else { wrong++; if (process.env.V) console.log("  wrong pc:", q, "→", g.title, g.subtitle); }
        const q2 = `г. Краснодар, ул. ${nm}, д. ${ix.hRaw[j]}`;
        const g2 = e.geocode(q2);
        nNoPc++;
        if (!g2) nulNoPc++; else if (haversineKm(g2, target) >= 0.05) { wrongNoPc++; if (process.env.V2) console.log("  nopc:", q2, "[цель:", st.area >= 0 ? ix.places[ix.places[st.area].settlement].name + "/" + ix.places[ix.places[st.area].settlement].kind : "?", "]→", g2.title, g2.subtitle, g2.precision, Math.round(haversineKm(g2, target) * 1000), "м"); }
      }
    }
  }
  console.log(`тёзки в Краснодаре с индексом: n=${n} верно ${ok}, чужой ${wrong}, отказ ${nul}; те же без индекса: отказ ${nulNoPc}, чужой ${wrongNoPc} (из ${nNoPc}; чужой = одна из двух, «уверенно не та»)`);
}
// 3. «Краснодар, <микрорайон>, ул. X, N» — тёзка в названном микрорайоне
{
  const hoods = ix.places.map((p: any, i: number) => i).filter((i: number) => ix.places[i].kind === "microdistrict" && ix.places[i].settlement === krd);
  let n = 0, top1 = 0, ok = 0, wrong = 0, nul = 0;
  for (const arr of byCore.values()) {
    const ul = arr.filter((i) => ix.streets[i].type === "улица");
    if (ul.length < 2) continue;
    for (const i of ul) {
      const st = ix.streets[i];
      const j = houseOf(st);
      if (j < 0) continue;
      const target = { lat: ix.hLat[j], lon: ix.hLon[j] };
      // тот же номер у тёзки
      const twin = ul.some((o) => o !== i && (() => { const t = ix.streets[o]; for (let k = t.start; k < t.end; k++) if (ix.hKey[k] === ix.hKey[j] && ix.hPrec[k] <= 1) return true; return false; })());
      if (!twin) continue;
      let hb = -1, hd = 1.2;
      for (const h of hoods) { const d = haversineKm(ix.places[h], target); if (d < hd) { hd = d; hb = h; } }
      if (hb < 0) continue;
      const q = `Краснодар, ${ix.places[hb].name}, ул. ${st.name.replace(/^улица /, "")}, ${ix.hRaw[j]}`;
      const hits = e.suggest(q);
      const g = e.geocode(q);
      n++;
      if (hits[0] && haversineKm(hits[0], target) < 0.05) top1++;
      if (!g) nul++; else if (haversineKm(g, target) < 0.05) ok++; else { wrong++; if (process.env.V) console.log("  wrong hood:", q, "→", g.title, g.subtitle, Math.round(haversineKm(g, target) * 1000), "м"); }
    }
  }
  console.log(`«Краснодар, микрорайон, тёзка»: n=${n} топ-1 ${top1}; geocode верно ${ok}, чужой ${wrong}, отказ ${nul}`);
}
