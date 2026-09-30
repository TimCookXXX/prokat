// Экспорт индекса геокодера из БД в JSON (GeoIndexData, src/lib/geocoder/types.ts) — для тестов,
// замера качества и как запасной путь загрузки (GEOCODER_INDEX_FILE). Те же данные, что читает сервер.
// Запуск: pnpm db:export-geo [city=krasnodar] [out=data/geocoder/build/index.<city>.json]

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Pool } from "pg";
import { loadGeoIndexFromDb } from "../../src/server/geocoder-index";

async function main() {
  const city = process.argv[2] ?? "krasnodar";
  const out = process.argv[3] ?? `data/geocoder/build/index.${city}.json`;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    const t0 = Date.now();
    const data = await loadGeoIndexFromDb(pool, city);
    if (!data) {
      console.error(`Нет импорта геокодера для города ${city} — сначала scripts/geocoder/prepare.sh`);
      process.exit(1);
    }
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(data));
    console.log(`${out}: версия ${data.version}; мест ${data.places.length}, улиц ${data.streets.length}, `
      + `домов ${data.houses.length}, объектов ${data.pois?.length ?? 0} (${Date.now() - t0} мс)`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
