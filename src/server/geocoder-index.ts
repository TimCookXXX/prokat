// Данные своего геокодера из БД: geo_places / geo_streets / geo_houses / geo_pois → GeoIndexData
// (контракт — src/lib/geocoder/types.ts). Таблицы пишет импорт scripts/geocoder (OSM + ГАР ФНС).
// Кэш — в памяти процесса: версия (последняя строка geo_imports города) сверяется не чаще раза
// в VERSION_CHECK_MS, при смене данные перечитываются, старые отдаются, пока не прочитаны новые.
// Поисковый движок строится поверх этих данных в src/lib/geocoder, здесь только загрузка.
// Запасной путь — готовый JSON (scripts/geocoder/export.ts → data/geocoder/build/index.<city>.json):
// если в БД импорта нет, а переменная GEOCODER_INDEX_FILE указывает на файл.

import { readFile } from "node:fs/promises";
import type { ClientBase, Pool } from "pg";
import { getPool } from "@/lib/db";
import type {
  AddrPrecision, AddrSource, GeoIndexData, IndexHouse, IndexPlace, IndexPoi, IndexStreet, PlaceKind,
} from "@/lib/geocoder/types";

const VERSION_CHECK_MS = 60_000;

interface CacheEntry {
  version: string;
  data: GeoIndexData;
  checkedAt: number;
  fromFile: boolean;
}

const cache = new Map<string, CacheEntry>();
const loading = new Map<string, Promise<GeoIndexData | null>>();

/** Пул или отдельное соединение — для запросов версии и загрузки. */
type Queryable = Pick<ClientBase, "query">;

/** Последний импорт города: версия данных и время сборки; null — импорта нет. */
export async function getGeoIndexVersion(
  pool: Queryable, citySlug: string,
): Promise<{ version: string; builtAt: string } | null> {
  // built_at пишет импорт в UTC (timestamp без зоны) — отдаём строкой, без пересчёта в зону процесса.
  const r = await pool.query<{ version: string; built_at: string }>(
    `select i.version, to_char(i.built_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as built_at
     from geo_imports i join cities c on c.id = i.city_id
     where c.slug = $1 order by i.built_at desc limit 1`,
    [citySlug],
  );
  const row = r.rows[0];
  return row ? { version: row.version, builtAt: row.built_at } : null;
}

/** Строки таблиц в порядке полей запросов loadGeoIndexFromDb (rowMode: array). */
export type PlaceRow = [string, string, string, string[] | null, string | null, number, number];
export type StreetRow = [
  string, string | null, string, string, string[] | null, number, number, number,
  ([number, number][][] | null)?,      // line — линия улицы (необязательна: старые строки без неё)
];
export type HouseRow = [string | null, string | null, string, number, number, string, string, string | null];
export type PoiRow = [string, string, string, string[] | null, string | null, number, number, string | null];

/** Строки таблиц → GeoIndexData. Чистая функция: порядок полей — как в запросах loadGeoIndexFromDb. */
export function rowsToGeoIndex(
  meta: { version: string; citySlug: string; builtAt: string },
  places: PlaceRow[], streets: StreetRow[], houses: HouseRow[], pois: PoiRow[],
): GeoIndexData {
  return {
    version: meta.version,
    citySlug: meta.citySlug,
    builtAt: meta.builtAt,
    places: places.map(([id, kind, name, aliases, parentId, lat, lon]): IndexPlace => ({
      id, kind: kind as PlaceKind, name, aliases: aliases ?? [], parentId, lat, lon,
    })),
    streets: streets.map(([id, placeId, name, type, aliases, lat, lon, houseCount, line]): IndexStreet => {
      const s: IndexStreet = { id, placeId, name, type, aliases: aliases ?? [], lat, lon, houses: houseCount };
      if (line && line.length) s.line = line;
      return s;
    }),
    houses: houses.map(([streetId, placeId, number, lat, lon, precision, source, postcode]): IndexHouse => {
      const h: IndexHouse = {
        streetId, placeId, number, lat, lon,
        precision: precision as AddrPrecision, source: source as AddrSource,
      };
      if (postcode) h.postcode = postcode;
      return h;
    }),
    pois: pois.map(([id, name, kind, aliases, placeId, lat, lon, address]): IndexPoi => ({
      id, name, kind, aliases: aliases ?? [], placeId, lat, lon, address,
    })),
  };
}

/**
 * Читает индекс города из таблиц (≈0,5–2 с на агломерацию); null — импорта для города нет.
 *
 * Отдельное соединение, закрываемое сразу после загрузки: pg держит результат последнего запроса
 * соединения, пока оно живо. Раньше четыре запроса шли через общий пул параллельно, по разным
 * соединениям, и соединение с домами держало ≈ 470 тыс. массивов строк, пока не простоит 10 с, —
 * под постоянным трафиком это +135 МБ кучи навсегда. Замер: README движка, «Память».
 */
export async function loadGeoIndexFromDb(pool: Pool, citySlug: string): Promise<GeoIndexData | null> {
  const client = await pool.connect();
  try {
    return await loadGeoIndexWith(client, citySlug);
  } finally {
    client.release(true);            // true — закрыть соединение, а не вернуть в пул
  }
}

async function loadGeoIndexWith(db: Queryable, citySlug: string): Promise<GeoIndexData | null> {
  const ver = await getGeoIndexVersion(db, citySlug);
  if (!ver) return null;
  const city = await db.query<{ id: string }>("select id from cities where slug = $1", [citySlug]);
  const cityId = city.rows[0]?.id;
  if (!cityId) return null;
  // По одному: соединение одно, запросы всё равно идут друг за другом.
  const q = async <R>(text: string): Promise<R[]> =>
    (await db.query({ text, values: [cityId], rowMode: "array" })).rows as unknown as R[];
  const places = await q<PlaceRow>(`select id, kind, name, aliases, parent_id, lat, lon from geo_places where city_id = $1 order by id`);
  const streets = await q<StreetRow>(`select id, place_id, name, type, aliases, lat, lon, houses, line from geo_streets
                  where city_id = $1 order by id`);
  const houses = await q<HouseRow>(`select street_id, place_id, number, lat, lon, precision::text, source::text, postcode
                 from geo_houses where city_id = $1 order by street_id nulls last, number_norm`);
  const pois = await q<PoiRow>(`select id, name, kind, aliases, place_id, lat, lon, address from geo_pois
               where city_id = $1 order by id`);
  return rowsToGeoIndex({ version: ver.version, citySlug, builtAt: ver.builtAt }, places, streets, houses, pois);
}

/** Индекс из JSON-файла (запасной путь и тесты). Проверяет форму верхнего уровня. */
export async function loadGeoIndexFile(path: string): Promise<GeoIndexData> {
  const data = JSON.parse(await readFile(path, "utf8")) as GeoIndexData;
  if (!data || typeof data.version !== "string" || !Array.isArray(data.places) || !Array.isArray(data.streets)
      || !Array.isArray(data.houses)) {
    throw new Error(`geocoder index file is malformed: ${path}`);
  }
  return data;
}

async function loadFresh(citySlug: string): Promise<{ data: GeoIndexData; fromFile: boolean } | null> {
  const fromDb = await loadGeoIndexFromDb(getPool(), citySlug);
  if (fromDb) return { data: fromDb, fromFile: false };
  const file = process.env.GEOCODER_INDEX_FILE;
  if (file) {
    const data = await loadGeoIndexFile(file);
    return data.citySlug === citySlug ? { data, fromFile: true } : null;
  }
  return null;
}

/**
 * Данные геокодера города из кэша процесса. Первая загрузка ждёт БД; дальше версия сверяется раз в
 * минуту и при смене данные перечитываются. null — адресов для города нет (геокодер выключен).
 */
export async function getGeoIndexData(citySlug: string): Promise<GeoIndexData | null> {
  const now = Date.now();
  const hit = cache.get(citySlug);
  if (hit && now - hit.checkedAt < VERSION_CHECK_MS) return hit.data;

  const pending = loading.get(citySlug);
  if (pending) return hit ? hit.data : pending;

  const task = (async () => {
    try {
      if (hit) {
        const ver = await getGeoIndexVersion(getPool(), citySlug);
        const same = ver ? !hit.fromFile && ver.version === hit.version && ver.builtAt === hit.data.builtAt
          : hit.fromFile;                  // из файла — пока в БД не появился импорт
        if (same) {
          hit.checkedAt = Date.now();
          return hit.data;
        }
      }
      const fresh = await loadFresh(citySlug);
      if (fresh) {
        const { data, fromFile } = fresh;
        cache.set(citySlug, { version: data.version, data, checkedAt: Date.now(), fromFile });
      } else cache.delete(citySlug);
      return fresh ? fresh.data : null;
    } catch (e) {
      // БД недоступна: отдаём прежние данные, если были, и пробуем снова через VERSION_CHECK_MS.
      if (hit) {
        hit.checkedAt = Date.now();
        return hit.data;
      }
      throw e;
    } finally {
      loading.delete(citySlug);
    }
  })();
  loading.set(citySlug, task);
  return hit ? hit.data : task;
}

/** Сброс кэша (тесты, ручная перезагрузка после импорта). */
export function resetGeoIndexCache(): void {
  cache.clear();
  loading.clear();
}
