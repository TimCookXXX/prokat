// Геокодер Яндекса (ТЗ, пп. 3.3, 8.1, 9): внешние API — только через сервер, с
// кэшем ответов. Два продукта и два ключа кабинета разработчика Яндекса:
//   YANDEX_GEOCODER_API_KEY — HTTP Геокодер: адрес → координаты (импорт, выбор подсказки);
//   YANDEX_SUGGEST_API_KEY  — API Геосаджеста: подсказки адресов при вводе.
// Нет ключа — функция отвечает «не умею» (null / []), остальное работает без адресов.
// Условия использования и лимиты тарифа проверяются владельцем ключа.

import { getEnv } from "@/lib/env";
import type { GeoPoint } from "@/lib/compare/geo";

const GEOCODER_URL = "https://geocode-maps.yandex.ru/1.x/";
const SUGGEST_URL = "https://suggest-maps.yandex.ru/v1/suggest";
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;

/** Прямоугольник поиска по городу: [[lon, lat] юго-запад, [lon, lat] северо-восток]. */
export type BBox = [[number, number], [number, number]];

// Краснодар с пригородами — чтобы «Северная, 15» не уехала в другой город.
export const CITY_BBOX: Record<string, BBox> = {
  krasnodar: [[38.75, 44.93], [39.3, 45.22]],
};

// ------------------------------------------------------------------ кэш

const cache = new Map<string, { at: number; value: unknown }>();

/** Кэш ответов. Сбой (таймаут, 429/5xx, сеть) — исключение из `load`: он не кэшируется. */
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------------ геокодер

export function geocoderEnabled(): boolean {
  return !!getEnv().YANDEX_GEOCODER_API_KEY;
}

export function suggestEnabled(): boolean {
  const env = getEnv();
  return !!env.YANDEX_SUGGEST_API_KEY && !!env.YANDEX_GEOCODER_API_KEY;
}

interface GeocoderResponse {
  response?: {
    GeoObjectCollection?: {
      featureMember?: { GeoObject?: { Point?: { pos?: string }; name?: string; metaDataProperty?: { GeocoderMetaData?: { precision?: string } } } }[];
    };
  };
}

/** Координаты первого результата; точность хуже улицы — не считаем найденным. */
function firstPoint(data: GeocoderResponse): (GeoPoint & { name: string | null }) | null {
  const obj = data.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
  const pos = obj?.Point?.pos?.split(" ").map(Number);
  const precision = obj?.metaDataProperty?.GeocoderMetaData?.precision;
  if (!pos || pos.length !== 2 || pos.some((n) => !Number.isFinite(n))) return null;
  if (precision && !["exact", "number", "near", "range", "street"].includes(precision)) return null;
  return { lon: pos[0], lat: pos[1], name: obj?.name ?? null };
}

function geocoderUrl(params: Record<string, string>, bbox?: BBox): string {
  const q = new URLSearchParams({ apikey: getEnv().YANDEX_GEOCODER_API_KEY!, format: "json", lang: "ru_RU", results: "1", ...params });
  if (bbox) { q.set("bbox", `${bbox[0].join(",")}~${bbox[1].join(",")}`); q.set("rspn", "1"); }
  return `${GEOCODER_URL}?${q}`;
}

/** Прямоугольник города; неизвестный город (в т.ч. «constructor») — без ограничения. */
function cityBBox(citySlug: string): BBox | undefined {
  return Object.hasOwn(CITY_BBOX, citySlug) ? CITY_BBOX[citySlug] : undefined;
}

/** Адрес в городе → точка. null — нет ключа, не нашлось или сервис недоступен. */
export async function geocodeAddress(address: string, cityName: string, citySlug = "krasnodar"): Promise<GeoPoint | null> {
  if (!geocoderEnabled()) return null;
  const text = `${cityName}, ${address}`.trim();
  try {
    return await cached(`g:${text.toLowerCase()}`, async () => {
      const p = firstPoint(await getJson(geocoderUrl({ geocode: text }, cityBBox(citySlug))) as GeocoderResponse);
      return p ? { lat: p.lat, lon: p.lon } : null;
    });
  } catch {
    return null;
  }
}

/** Точка по uri подсказки Геосаджеста — надёжнее, чем геокодировать текст заново. */
export async function geocodeUri(uri: string): Promise<GeoPoint | null> {
  if (!geocoderEnabled()) return null;
  try {
    return await cached(`u:${uri}`, async () => {
      const p = firstPoint(await getJson(geocoderUrl({ uri })) as GeocoderResponse);
      return p ? { lat: p.lat, lon: p.lon } : null;
    });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ подсказки

export interface AddressSuggestion {
  /** «улица Северная, 15» */
  title: string;
  /** «Краснодар» */
  subtitle: string | null;
  uri: string;
}

interface SuggestResponse {
  results?: { title?: { text?: string }; subtitle?: { text?: string }; uri?: string }[];
}

/** Подсказки адресов в городе; [] — нет ключа, нет совпадений или сервис недоступен. */
export async function suggestAddresses(text: string, citySlug = "krasnodar"): Promise<AddressSuggestion[]> {
  const q = text.trim();
  if (!suggestEnabled() || q.length < 3) return [];
  const bbox = cityBBox(citySlug);
  // Подсказки — только в пределах известного города: без рамки Яндекс ищет по всей стране.
  if (!bbox) return [];
  try {
    return await cached(`s:${citySlug}:${q.toLowerCase()}`, async () => {
      const params = new URLSearchParams({
        apikey: getEnv().YANDEX_SUGGEST_API_KEY!, text: q, lang: "ru", results: "5",
        types: "house,street", print_address: "0", attrs: "uri",
        bbox: `${bbox[0].join(",")}~${bbox[1].join(",")}`, strict_bounds: "1",
      });
      const data = await getJson(`${SUGGEST_URL}?${params}`) as SuggestResponse;
      return (data.results ?? [])
        .filter((r) => r.title?.text && r.uri)
        .map((r) => ({ title: r.title!.text!, subtitle: r.subtitle?.text ?? null, uri: r.uri! }));
    });
  } catch {
    return [];
  }
}
