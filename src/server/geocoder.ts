// Свой геокодер агломерации (адреса OSM + ГАР ФНС, без внешних сервисов): подсказки «Где»,
// обратное геокодирование «Моё местоположение», мини-индекс для браузера и адреса прокатов
// при CSV-импорте. Поиск — src/lib/geocoder (README там), данные — src/server/geocoder-index.ts.
//
// Движок — один на процесс и город: строится лениво при первом запросе (≈0,4 с) из данных
// getGeoIndexData и пересобирается, когда те сменились (новый импорт в geo_imports).
// Адресов в базе нет — функции отвечают «не умею» ([] / null), микрорайоны и округа
// «Где» работают без них.

import { createHash } from "node:crypto";
import { buildClientIndex, Engine, type Geocoder } from "@/lib/geocoder";
import { buildIndex } from "@/lib/geocoder/index-build";
import type { AddressHit, GeoIndexData } from "@/lib/geocoder/types";
import type { GeoPoint } from "@/lib/compare/geo";
import { getPool } from "@/lib/db";
import { getGeoIndexData, getGeoIndexVersion } from "@/server/geocoder-index";

interface CityEngine {
  geocoder: Geocoder;
  /** Метка данных для ETag и ссылки на мини-индекс: версия выгрузок + время импорта. */
  token: string;
  /** Мини-индекс браузера (JSON, ≈ 1,3 МБ; gzip ≈ 0,3 МБ). */
  clientJson: string;
}

// Движки по объекту данных (getGeoIndexData отдаёт один объект, пока версия та же). На globalThis:
// в dev модуль перезагружается при правке, а кэш данных — нет, и движок должен найтись снова
// (дома из данных уже отпущены — второй раз его не собрать).
const G = globalThis as { __inrentaGeoEngines?: WeakMap<GeoIndexData, CityEngine> };
const engines = (): WeakMap<GeoIndexData, CityEngine> => (G.__inrentaGeoEngines ??= new WeakMap());

/** Метка версии данных: короткий хэш версии выгрузок и времени импорта. */
export function dataToken(v: { version: string; builtAt: string }): string {
  return createHash("sha1").update(`${v.version}|${v.builtAt}`).digest("base64url").slice(0, 16);
}

/** Движок города: тот же объект, пока данные не сменились. null — адресов для города нет. */
export async function getCityGeocoder(citySlug: string): Promise<CityEngine | null> {
  const data = await getGeoIndexData(citySlug);
  if (!data) return null;
  const cur = engines().get(data);
  if (cur) return cur;
  // Сборка синхронная (≈0,4 с): параллельный запрос, дождавшийся тех же данных, увидит готовый движок.
  const ix = buildIndex(data);
  const engine: CityEngine = {
    geocoder: new Engine(ix), token: dataToken(data), clientJson: JSON.stringify(buildClientIndex(data, ix)),
  };
  // Дома нужны только для сборки: движок держит их в своих массивах, мини-индекс — без домов.
  // Отпускаем объекты домов из кэша данных — это ≈ 120 МБ кучи из ≈ 175; при новом импорте
  // данные перечитываются целиком (новый объект — новый движок).
  data.houses = [];
  engines().set(data, engine);
  return engine;
}

/** Сброс движков (тесты). */
export function resetGeocoderEngines(): void {
  G.__inrentaGeoEngines = new WeakMap();
  readyCache.clear();
}

const readyCache = new Map<string, { at: number; token: string | null }>();
const READY_TTL_MS = 60_000;

/**
 * Есть ли адреса для города — для страницы, без загрузки индекса: метка данных или null.
 * Метка уходит в ссылку на мини-индекс (/api/geo/client-index?v=…), поэтому его можно
 * кэшировать навсегда. Заодно в фоне прогревает движок, чтобы первая подсказка была быстрой.
 */
export async function addressIndexToken(citySlug: string): Promise<string | null> {
  const hit = readyCache.get(citySlug);
  if (hit && Date.now() - hit.at < READY_TTL_MS) return hit.token;
  let token: string | null = null;
  try {
    const ver = await getGeoIndexVersion(getPool(), citySlug);
    if (ver) token = dataToken(ver);
    else if (process.env.GEOCODER_INDEX_FILE) token = "file";
  } catch (e) {
    // БД недоступна — адреса выключены до следующей проверки (микрорайоны и округа работают).
    console.error("[geocoder] version check failed:", (e as Error).message);
  }
  readyCache.set(citySlug, { at: Date.now(), token });
  if (token) void getCityGeocoder(citySlug).catch((e) => console.error("[geocoder] warm-up failed:", (e as Error).message));
  return token;
}

// ------------------------------------------------------------------ подсказки и обратный геокодер

export const SUGGEST_LIMIT = 7;

/** Подсказки адресов «Где» — сразу с координатами и точностью. */
export async function suggestAddresses(
  q: string, citySlug: string, opts: { near?: GeoPoint | null; limit?: number } = {},
): Promise<AddressHit[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const engine = await getCityGeocoder(citySlug);
  if (!engine) return [];
  return engine.geocoder.suggest(text, { limit: opts.limit ?? SUGGEST_LIMIT, near: opts.near ?? null }).map(slimHit);
}

/** Точка → ближайший адрес: дом ≤ 60 м, иначе улица, иначе населённый пункт; далеко от всего — null. */
export async function reverseGeocode(p: GeoPoint, citySlug: string): Promise<AddressHit | null> {
  const engine = await getCityGeocoder(citySlug);
  const hit = engine?.geocoder.reverse(p.lat, p.lon) ?? null;
  return hit ? slimHit(hit) : null;
}

/** Мини-индекс браузера (улицы, пункты, объекты — без домов) и его метка; null — адресов нет. */
export async function clientIndexJson(citySlug: string): Promise<{ json: string; token: string } | null> {
  const engine = await getCityGeocoder(citySlug);
  return engine ? { json: engine.clientJson, token: engine.token } : null;
}

/** В ответ API — без внутренней оценки; координаты — до 6 знаков (≈ 0,1 м). */
function slimHit(h: AddressHit): AddressHit {
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  const out: AddressHit = { ...h, lat: r6(h.lat), lon: r6(h.lon), score: Math.round(h.score * 10) / 10 };
  return out;
}

// ------------------------------------------------------------------ адреса прокатов (CSV-импорт)

/** Ответ геокодера для адреса проката. */
export type ShopGeocode =
  | {
    point: GeoPoint;
    /** Что нашлось: «улица Красная, 120» или «улица Ставропольская, ≈106». */
    found: string;
    /**
     * Что стоит проверить глазами, хотя точка записана: адрес нашёлся не в городе проката, а пункт
     * в адресе не назван. null — проверять нечего.
     */
    check: string | null;
  }
  | { point: null; reason: string; found?: string };

/**
 * Адрес проката → точка, строго: только однозначный дом из адресной базы с точной точкой
 * (здание, адресный узел или интерполяция данных). Пункт в адресе не назван, а такой адрес есть
 * в нескольких пунктах — ищем в городе проката («Краснодар, …»). Всё, что «≈», — без координат,
 * с причиной (прокат покажется от центра микрорайона с «≈»): номера нет в базе (найдено до улицы,
 * хотя движок и оценил точку по соседям), точка дома в базе примерная, только улица или пункт.
 */
export function geocodeShopAddress(g: Geocoder, address: string, cityName: string): ShopGeocode {
  let r = g.geocodeDetailed(address, { strict: true });
  if (!r.hit && r.reason === "ambiguous_place") {
    // Только если ответ — в самом городе: «Краснодар, …» движок допускает и для посёлков у его
    // границы (так пишут жители Новой Адыгеи), а здесь это была бы догадка.
    const inCity = g.geocodeDetailed(`${cityName}, ${address}`, { strict: true });
    if (inCity.hit && inCity.hit.parts?.place === cityName) r = inCity;
  }
  const hit = r.hit;
  if (!hit) {
    const alts = r.alternatives.slice(0, 3).map((a) => `${a.title} (${a.subtitle})`).join("; ");
    return { point: null, reason: `${r.message ?? "Адрес не найден"}${alts ? `: ${alts}` : ""}` };
  }
  const found = `${hit.title}, ${hit.subtitle}`;
  if ((hit.kind !== "house" && hit.kind !== "poi") || (hit.precision !== "house" && hit.precision !== "interpolated")) {
    return {
      point: null, found,
      reason: hit.kind === "place" || hit.precision === "place"
        ? `найден только населённый пункт (${found}) — уточните улицу и дом или укажите lat/lon`
        : hit.kind === "house"
          ? `до улицы: дом есть в адресном реестре, но его точка известна только примерно (${found}) — укажите lat/lon`
          : hit.parts?.street && /≈/.test(hit.title)
            ? `до улицы: такого номера нет в адресной базе (${found}) — проверьте номер или укажите lat/lon`
            : `до улицы: дом не указан (${found}) — уточните номер или укажите lat/lon`,
    };
  }
  const fold = (x: string) => x.toLowerCase().replace(/ё/g, "е");
  const place = hit.parts?.place ?? null;
  const check = place && place !== cityName && !fold(address).includes(fold(place))
    ? `адрес найден не в городе, а в пункте «${place}» — проверьте`
    : null;
  return { point: { lat: hit.lat, lon: hit.lon }, found, check };
}
