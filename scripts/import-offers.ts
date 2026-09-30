// Импорт цен прокатов из CSV. Шаблоны (docs/inrenta-pivot/data/): простой —
// prokaty.template.csv (колонки по-русски), полный — offers.template.csv.
// Файл проверяется целиком: при любой ошибке в базу не пишется ничего.
// Запуск: pnpm db:import-offers <file.csv> [--dry-run]

import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { RowError } from "../src/lib/compare/offers-csv";
import { parseOffersFile } from "../src/lib/compare/offers-simple";
import { importOffers, type Geocode } from "../src/server/compare/import-offers";
import { geocodeShopAddress } from "../src/server/geocoder";
import { loadGeoIndexFromDb } from "../src/server/geocoder-index";
import { createGeocoder, type Geocoder } from "../src/lib/geocoder";
import { addDaysStr, todayStr } from "../src/lib/catalog/dates";

function printErrors(errors: RowError[]) {
  for (const e of errors) console.error(`  ${e.line ? `строка ${e.line}` : "файл"}: ${e.message}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: import-offers <file.csv> [--dry-run]");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  // todayStr() — дата по UTC, а цены проверяют по местному времени (UTC+3 и восточнее):
  // сутки запаса, чтобы проверка «сегодня» ночью не считалась датой из будущего.
  const parsed = parseOffersFile(await readFile(file, "utf8"), addDaysStr(todayStr(), 1));
  if (parsed.errors.length) {
    console.error(`Файл не импортирован — ошибок: ${parsed.errors.length}`);
    printErrors(parsed.errors);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  // Адреса без lat/lon — своим геокодером по адресам города из БД (geo_*; импорт — scripts/geocoder).
  const engines = new Map<string, Promise<Geocoder | null>>();
  const engine = (citySlug: string) => {
    let e = engines.get(citySlug);
    if (!e) {
      e = loadGeoIndexFromDb(pool, citySlug).then((data) => {
        if (!data) console.warn(`Адресов города «${citySlug}» нет в базе (scripts/geocoder/prepare.sh) — адреса без lat/lon останутся без координат.`);
        return data ? createGeocoder(data) : null;
      });
      engines.set(citySlug, e);
    }
    return e;
  };
  const geocode: Geocode = async (address, city) => {
    const g = await engine(city.slug);
    return g ? geocodeShopAddress(g, address, city.name) : { point: null, reason: "адресов города нет в базе" };
  };
  // Индексы — до транзакции импорта: загрузка идёт по отдельному соединению.
  for (const slug of new Set(parsed.rows.filter((row) => row.address && (row.lat == null || row.lon == null)).map((row) => row.citySlug))) {
    await engine(slug);
  }
  const r = await importOffers(drizzle(pool), parsed.rows, { dryRun, geocode });
  await pool.end();

  if (r.errors.length) {
    console.error(`Файл не импортирован — ошибок: ${r.errors.length}`);
    printErrors(r.errors);
    process.exit(1);
  }
  console.log(
    `${dryRun ? "[dry-run, ничего не записано] " : ""}Строк: ${parsed.rows.length}. ` +
    `Прокатов: новых ${r.shopsCreated}, найдено ${r.shopsMatched}. ` +
    `Предложений: новых ${r.offersCreated}, обновлено ${r.offersUpdated}, ` +
    `пропущено (в базе проверка свежее) ${r.offersSkippedStale}.`,
  );
  if (r.unrecognizedModels.length) {
    console.warn(`\nНераспознанные модели (${r.unrecognizedModels.length}) — предложения привязаны к классу; добавьте модель в src/lib/compare/models-data.ts:`);
    for (const m of r.unrecognizedModels) console.warn(`  строка ${m.line}: ${m.model}`);
  }
  if (r.addressesWithoutCoords.length) {
    console.warn(`\nАдреса без координат (${r.addressesWithoutCoords.length}) — прокат покажется от центра микрорайона (≈); уточните адрес или укажите lat/lon:`);
    for (const a of r.addressesWithoutCoords) console.warn(`  строка ${a.line}: ${a.shop} — ${a.address}: ${a.reason}`);
  }
  if (r.addressesToCheck.length) {
    console.warn(`\nАдреса с координатами, которые стоит проверить (${r.addressesToCheck.length}):`);
    for (const a of r.addressesToCheck) console.warn(`  строка ${a.line}: ${a.shop} — ${a.address} → ${a.found}: ${a.check}`);
  }
  if (r.unknownMicrodistricts.length) {
    console.warn(`\nМикрорайоны не из справочника (${r.unknownMicrodistricts.length}) — src/lib/compare/geo-data.ts:`);
    for (const d of r.unknownMicrodistricts) console.warn(`  строка ${d.line}: ${d.value}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
