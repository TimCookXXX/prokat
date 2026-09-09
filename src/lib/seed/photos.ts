// Фотографии сида лежат в том же бакете, что и пользовательские загрузки, —
// репозиторию сотня webp'ов не нужна, а git хранил бы каждую их версию вечно.
//
// В git едет только манифест: имя файла из колонки `photos` → ключ объекта и
// размеры. Он крошечный, текстовый и решает главную задачу — на сервере, где
// исходников нет, сид собирает photos_json, не трогая ни бакет, ни sharp.
//
// В манифесте лежит ключ, а НЕ готовый адрес: адрес зависит от
// STORAGE_PUBLIC_BASE, а он разный у локального MinIO и у прода. Один манифест
// обязан работать в обоих, поэтому URL собирается в момент записи в базу.

import { createHash } from "node:crypto";
import { z } from "zod";
import { slugify } from "@/lib/slugify";

/** Отдельный префикс от uploads/: видно, что это витрина, а не чужой файл. */
export const SEED_PHOTO_PREFIX = "seed";

export interface SeedPhotoEntry {
  key: string;
  width: number;
  height: number;
}

export type SeedPhotoManifest = Record<string, SeedPhotoEntry>;

export const seedPhotoManifestSchema = z.record(
  z.string(),
  z.object({
    key: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
);

/**
 * Ключ объекта: слаг имени файла плюс отпечаток содержимого.
 *
 * Хеш тут не украшение и решает две задачи разом. Первая — putObject ставит
 * `immutable` на год (см. lib/storage/upload.ts): по стабильному ключу
 * заменённый снимок провисел бы в кэше старым, и ловилось бы это мучительно.
 * Вторая — ключ перестаёт зависеть от чего-либо, кроме самого файла: два
 * разных снимка с одинаковым слагом («IMG 01.jpg» и «img-01.png») разъезжаются
 * сами, без счётчика коллизий, а значит и без зависимости от порядка строк в
 * listings.csv. Иначе перестановка строк молча увела бы ключ к чужой картинке.
 *
 * Считается по обработанному webp, а не по исходнику: в бакет уезжает именно
 * он, и именно его подмену должен ловить кэш.
 */
export function seedPhotoKey(source: string, content: Buffer): string {
  const base = (source.split("/").pop() ?? source).replace(/\.[^.]+$/, "");
  const slug = slugify(base) || "photo";
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 8);
  return `${SEED_PHOTO_PREFIX}/${slug}-${digest}.webp`;
}

/** Имена, которых в манифесте нет, — по ним сид не соберёт photos_json. */
export function missingFromManifest(
  sources: string[],
  manifest: SeedPhotoManifest,
): string[] {
  return [...new Set(sources)].filter((s) => !manifest[s]);
}
