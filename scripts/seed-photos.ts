// Подготовка фотографий сида: обработать исходники из seed_real/Фото/ и залить
// в тот же бакет, куда складываются пользовательские загрузки.
//
// Запуск: pnpm seed:photos (нужны STORAGE_* в .env и сами исходники).
// Делает это тот, у кого снимки на диске, и делает редко — при появлении новых
// фотографий. Наполнение базы (pnpm db:seed:real) ни бакета, ни исходников не
// требует: оно читает манифест seed_real/photos.json, который пишется здесь и
// едет в git.
//
// Обработка — та же, что у настоящей загрузки через /api/upload: проверка, что
// это картинка поддерживаемого формата, поворот по EXIF, ресайз до 2560 и webp.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeToWebp } from "../src/lib/images/normalize";
import { ACCEPTED_MIME, detectMime } from "../src/lib/images/validate";
import { objectExists, putObject } from "../src/lib/storage/upload";
import { seedPhotoKey, type SeedPhotoManifest } from "../src/lib/seed/photos";
import {
  PHOTO_SRC_DIR, die, photoSources, readManifest, readSeedData, writeManifest,
} from "./seed-source";

const STORAGE_VARS = [
  "STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_BASE",
];

interface Prepared { source: string; input: Buffer }

async function main() {
  const data = await readSeedData();
  const sources = photoSources(data);

  if (sources.length === 0) {
    console.log("В listings.csv не названо ни одной фотографии — заливать нечего");
    return;
  }

  const missingEnv = STORAGE_VARS.filter((v) => !process.env[v]);
  if (missingEnv.length > 0) {
    die(`Не заданы переменные хранилища: ${missingEnv.join(", ")}\nСм. docs/environment.md`);
  }

  const manifest: SeedPhotoManifest = await readManifest();

  // Сначала проверяем все исходники и только потом заливаем хоть один. Иначе
  // сорок файлов уехали бы в бакет, сорок первый оказался бы heic, и скрипт
  // упал бы, оставив в хранилище объекты, которых нет ни в манифесте, ни в базе.
  const prepared: Prepared[] = [];
  const failures: string[] = [];
  let kept = 0;

  for (const source of sources) {
    const input = await readFile(path.join(PHOTO_SRC_DIR, source)).catch(() => null);

    if (!input) {
      // Исходника нет. Если файл уже залит прошлым прогоном — это нормально:
      // снимки могли остаться на другой машине, а манифест приехал по git.
      if (manifest[source]) { kept += 1; continue; }
      failures.push(`${source}: нет файла seed_real/Фото/${source} и нет записи в манифесте`);
      continue;
    }

    const mime = await detectMime(input);
    if (!mime) {
      failures.push(
        `${source}: не картинка или неподдерживаемый формат. ` +
        `Принимаются ${ACCEPTED_MIME.join(", ")} — снимки с айфона надо экспортировать в jpeg`,
      );
      continue;
    }

    prepared.push({ source, input });
  }

  if (failures.length > 0) {
    console.error(`Не удалось подготовить фотографии (${failures.length}):\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("\nМанифест не тронут, в бакет ничего не заливалось.");
    process.exit(1);
  }

  let uploaded = 0;
  let unchanged = 0;
  for (const { source, input } of prepared) {
    const normalized = await normalizeToWebp(input);
    const key = seedPhotoKey(source, normalized.buffer);
    // Пропускаем только то, что реально лежит в этом бакете. Совпадения ключа с
    // манифестом мало: ключ считается от содержимого, и после локального
    // прогона манифест «знает» все снимки — против пустого прод-бакета скрипт
    // счёл бы всё залитым и не отправил бы ни байта.
    if (manifest[source]?.key === key && await objectExists(key)) {
      unchanged += 1;
      continue;
    }
    await putObject({ key, body: normalized.buffer, contentType: "image/webp" });
    manifest[source] = { key, width: normalized.width, height: normalized.height };
    uploaded += 1;
  }

  // Записи, на которые больше никто не ссылается. Объекты в бакете не удаляем:
  // чужие данные сид сносить не вправе, а место они занимают копеечное.
  const orphans = Object.keys(manifest).filter((s) => !sources.includes(s));
  for (const source of orphans) delete manifest[source];

  await writeManifest(manifest);

  console.log(
    `Photos: uploaded ${uploaded}, unchanged ${unchanged}, kept ${kept}, ` +
    `total ${Object.keys(manifest).length}`,
  );
  if (orphans.length > 0) {
    console.log(`Из манифеста убрано ${orphans.length} записей без ссылок; объекты в бакете остались`);
  }
  console.log("Манифест seed_real/photos.json обновлён — не забудьте закоммитить");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
