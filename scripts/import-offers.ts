// Импорт цен прокатов из CSV (шаблон — docs/inrenta-pivot/data/offers.template.csv).
// Файл проверяется целиком: при любой ошибке в базу не пишется ничего.
// Запуск: pnpm db:import-offers <file.csv> [--dry-run]

import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parseOffersCsv, type RowError } from "../src/lib/compare/offers-csv";
import { importOffers } from "../src/server/compare/import-offers";
import { geocodeAddress, geocoderEnabled } from "../src/server/geocoder";
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
  const parsed = parseOffersCsv(await readFile(file, "utf8"), addDaysStr(todayStr(), 1));
  if (parsed.errors.length) {
    console.error(`Файл не импортирован — ошибок: ${parsed.errors.length}`);
    printErrors(parsed.errors);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const geocode = geocoderEnabled() ? geocodeAddress : null;
  if (!geocode) console.warn("YANDEX_GEOCODER_API_KEY не задан — адреса без lat/lon останутся без координат.");
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
    console.warn(`\nАдреса без координат (${r.addressesWithoutCoords.length}) — укажите lat/lon или уточните адрес:`);
    for (const a of r.addressesWithoutCoords) console.warn(`  строка ${a.line}: ${a.shop} — ${a.address}`);
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
