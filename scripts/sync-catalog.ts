// Синхронизирует справочник сравнения (города, категории, группы, классы) с
// src/lib/compare/catalog-data.ts. Идемпотентен; в production запускается из
// entrypoint после миграций.
// Запуск: pnpm db:sync-catalog

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { syncCatalog } from "../src/server/compare/catalog-sync";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const r = await syncCatalog(drizzle(pool));
  await pool.end();

  console.log(
    `Catalog synced: ${r.citiesCreated} cities and ${r.categoriesCreated} categories created, ` +
    `${r.groupsUpserted} groups and ${r.classesUpserted} classes upserted; ` +
    `${r.districtsUpserted} places, ${r.modelsUpserted} models, ${r.aliasesAdded} new model spellings`,
  );
  for (const p of r.modelProblems) console.warn(`Model: ${p}`);
  if (r.orphanGroups.length || r.orphanClasses.length) {
    console.warn(`Not in catalog-data (kept in DB): groups [${r.orphanGroups.join(", ")}], classes [${r.orphanClasses.join(", ")}]`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
