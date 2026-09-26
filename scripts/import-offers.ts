// Импорт цен прокатов из CSV (шаблон — docs/inrenta-pivot/data/offers.template.csv).
// Файл проверяется целиком: при любой ошибке в базу не пишется ничего.
// Запуск: pnpm db:import-offers <file.csv> [--dry-run]

import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parseOffersCsv, type RowError } from "../src/lib/compare/offers-csv";
import { importOffers } from "../src/server/compare/import-offers";
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
  const r = await importOffers(drizzle(pool), parsed.rows, { dryRun });
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
