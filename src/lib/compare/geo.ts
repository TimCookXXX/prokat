// «Где» пользователя и местоположение проката: расстояние, время в пути, округ
// точки. Чистые функции — без БД и внешних сервисов (ТЗ, пп. 3.3, 4.2, 4.3).

import { CITY_SPEED_KMH, ROUTE_FACTOR } from "@/lib/compare/config";
import { OKRUG_BOUNDS } from "@/lib/compare/okrug-bounds";
import type { GeoPoint } from "@/lib/compare/geo-data";
import { normalize, switchLayout } from "@/lib/compare/search";

export type { GeoPoint } from "@/lib/compare/geo-data";

export interface Okrug extends GeoPoint {
  slug: string;
  name: string;
  aliases: string[];
}

export interface Microdistrict extends GeoPoint {
  slug: string;
  name: string;
  okrug: string;
  aliases: string[];
}

export interface CityGeo {
  okrugs: Okrug[];
  microdistricts: Microdistrict[];
}

/**
 * Где пользователь. Город — без точки; округ — без точки, выдача делится на свой
 * и остальные; микрорайон — центр микрорайона (расстояние с «≈»); точка — адрес
 * или геолокация (расстояние точное), округ и микрорайон определены по точке.
 */
export type UserLocation =
  | { kind: "city" }
  | { kind: "okrug"; okrug: string }
  | { kind: "microdistrict"; microdistrict: string }
  | { kind: "point"; point: GeoPoint; label: string | null; source: "address" | "geo" };

export const CITY_LOCATION: UserLocation = { kind: "city" };

// ------------------------------------------------------------ расстояние

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** Расстояние по прямой, км. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export interface Trip {
  /** По дорогам ≈ по прямой × ROUTE_FACTOR, км. */
  km: number;
  /** В одну сторону, минут (целое). */
  minutes: number;
  /** Хотя бы одна точка — центр микрорайона. */
  approx: boolean;
}

/** Путь по дорогам от маршрутизатора (src/server/routing.ts). */
export interface RoadRoute {
  km: number;
  /** Время с пробками (Яндекс); null — по средней скорости города. */
  minutes: number | null;
}

/**
 * Путь между точками. `road` — от маршрутизатора; нет его — по прямой ×
 * ROUTE_FACTOR (ТЗ, п. 4.3), что ошибается через реку. Время — маршрутизатора
 * (Яндекс, с пробками) или по средней скорости города, в которой заложены пробки.
 */
export function tripBetween(a: GeoPoint, b: GeoPoint, approx: boolean, road?: RoadRoute | null): Trip {
  const km = road?.km ?? haversineKm(a, b) * ROUTE_FACTOR;
  return { km, minutes: road?.minutes ?? Math.round((km / CITY_SPEED_KMH) * 60), approx };
}

/** Ключ точки для карты расстояний (~1 м точности). */
export function pointKey(p: GeoPoint): string {
  return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
}

/** «3,2 км · ~8 мин»; приблизительное — «≈ 3 км · ~8 мин». */
export function tripLabel(t: Trip): string {
  const km = t.approx
    ? `≈ ${Math.max(1, Math.round(t.km))} км`
    : `${(Math.round(t.km * 10) / 10).toLocaleString("ru-RU")} км`;
  return `${km} · ~${Math.max(1, t.minutes)} мин`;
}

// ------------------------------------------------------------ точки

/** Точка, от которой считаем путь пользователя; null — город или округ. */
export function userPoint(loc: UserLocation, geo: CityGeo): { point: GeoPoint; approx: boolean } | null {
  if (loc.kind === "point") return { point: loc.point, approx: false };
  if (loc.kind === "microdistrict") {
    const m = geo.microdistricts.find((x) => x.slug === loc.microdistrict);
    return m ? { point: m, approx: true } : null;
  }
  return null;
}

/** Где прокат: координаты адреса → центр микрорайона (≈) → неизвестно. */
export function shopPoint(
  shop: { lat: number | null; lon: number | null; microdistrict: string | null },
  geo: CityGeo,
): { point: GeoPoint; approx: boolean } | null {
  if (shop.lat != null && shop.lon != null) return { point: { lat: shop.lat, lon: shop.lon }, approx: false };
  const m = shop.microdistrict ? geo.microdistricts.find((x) => x.slug === shop.microdistrict) : undefined;
  return m ? { point: m, approx: true } : null;
}

/** Округ, внутри которого точка (по границам OSM); null — вне города. */
export function okrugOfPoint(p: GeoPoint, bounds: Record<string, [number, number][][]> = OKRUG_BOUNDS): string | null {
  for (const [slug, lines] of Object.entries(bounds)) {
    let inside = false;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const [x1, y1] = line[i - 1];
        const [x2, y2] = line[i];
        if ((y1 > p.lat) !== (y2 > p.lat) && x1 + ((p.lat - y1) * (x2 - x1)) / (y2 - y1) > p.lon) inside = !inside;
      }
    }
    if (inside) return slug;
  }
  return null;
}

/** Ближайший микрорайон, если точка от его центра не дальше maxKm по прямой. */
export function nearestMicrodistrict(p: GeoPoint, geo: CityGeo, maxKm = 2.5): Microdistrict | null {
  let best: Microdistrict | null = null;
  let bestKm = Infinity;
  for (const m of geo.microdistricts) {
    const km = haversineKm(p, m);
    if (km < bestKm) { best = m; bestKm = km; }
  }
  return bestKm <= maxKm ? best : null;
}

/** Округ пользователя: для группировки выдачи и сводки. */
export function userOkrug(loc: UserLocation, geo: CityGeo): string | null {
  if (loc.kind === "okrug") return loc.okrug;
  if (loc.kind === "microdistrict") return geo.microdistricts.find((m) => m.slug === loc.microdistrict)?.okrug ?? null;
  if (loc.kind === "point") return okrugOfPoint(loc.point);
  return null;
}

// ------------------------------------------------------------ подписи

export function okrugName(slug: string | null, geo: CityGeo): string | null {
  return slug ? geo.okrugs.find((o) => o.slug === slug)?.name ?? null : null;
}

/** Текст поля «Где» после выбора: «ЮМР ≈», «ул. Северная, 15», «Прикубанский округ». */
export function locationLabel(loc: UserLocation, geo: CityGeo, cityName: string): string {
  switch (loc.kind) {
    case "city": return cityName;
    case "okrug": return okrugName(loc.okrug, geo) ?? cityName;
    case "microdistrict": {
      const m = geo.microdistricts.find((x) => x.slug === loc.microdistrict);
      return m ? `${m.name} ≈` : cityName;
    }
    case "point": return loc.label ?? (loc.source === "geo" ? "Моё местоположение" : "Точка на карте");
  }
}

// ------------------------------------------------------------ URL
//   loc=d:festivalnyy        микрорайон
//   loc=o:prikubanskiy       округ
//   loc=p:45.06210,38.95200  точка (адрес или геолокация), la — подпись, src=geo

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

export function parseLocation(
  raw: { loc?: string; la?: string; src?: string },
  geo: CityGeo,
): UserLocation {
  const v = raw.loc?.trim() ?? "";
  const [kind, rest = ""] = [v.slice(0, 1), v.slice(2)];
  if (v[1] !== ":") return CITY_LOCATION;
  if (kind === "d" && SLUG_RE.test(rest) && geo.microdistricts.some((m) => m.slug === rest)) {
    return { kind: "microdistrict", microdistrict: rest };
  }
  if (kind === "o" && SLUG_RE.test(rest) && geo.okrugs.some((o) => o.slug === rest)) {
    return { kind: "okrug", okrug: rest };
  }
  if (kind === "p") {
    const m = /^(-?\d{1,2}\.\d{1,6}),(-?\d{1,3}\.\d{1,6})$/.exec(rest);
    const lat = m ? Number(m[1]) : NaN;
    const lon = m ? Number(m[2]) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const label = raw.la?.trim().slice(0, 120) || null;
      return { kind: "point", point: { lat, lon }, label, source: raw.src === "geo" ? "geo" : "address" };
    }
  }
  return CITY_LOCATION;
}

/** Параметры URL для местоположения; город — пусто. */
export function locationQuery(loc: UserLocation): Record<string, string> {
  switch (loc.kind) {
    case "city": return {};
    case "okrug": return { loc: `o:${loc.okrug}` };
    case "microdistrict": return { loc: `d:${loc.microdistrict}` };
    case "point": {
      const q: Record<string, string> = { loc: `p:${loc.point.lat.toFixed(5)},${loc.point.lon.toFixed(5)}` };
      if (loc.label) q.la = loc.label;
      if (loc.source === "geo") q.src = "geo";
      return q;
    }
  }
}

// ------------------------------------------------------------ подсказки «Где»

export interface PlaceSuggestion {
  kind: "microdistrict" | "okrug";
  slug: string;
  title: string;
  subtitle: string;
}

/**
 * Микрорайоны и округа по вводу — сразу, без внешних сервисов (ТЗ, п. 3.3):
 * название, сокращения и разговорные («юмр», «Юбилейка»), любая раскладка.
 */
export function matchPlaces(query: string, geo: CityGeo, limit = 6): PlaceSuggestion[] {
  const forms = [...new Set([normalize(query), normalize(switchLayout(query))])].filter((f) => f.length >= 2);
  if (!forms.length) return [];
  const score = (names: string[]) => {
    let best = 0;
    for (const n of names.map(normalize)) {
      for (const f of forms) {
        if (n === f) best = Math.max(best, 3);
        else if (n.startsWith(f)) best = Math.max(best, 2);
        else if (n.split(" ").some((w) => w.startsWith(f))) best = Math.max(best, 1.5);
      }
    }
    return best;
  };
  const out: (PlaceSuggestion & { s: number })[] = [];
  for (const m of geo.microdistricts) {
    const s = score([m.name, ...m.aliases]);
    if (s) out.push({ kind: "microdistrict", slug: m.slug, title: m.name, subtitle: okrugName(m.okrug, geo) ?? "микрорайон", s: s + 0.1 });
  }
  for (const o of geo.okrugs) {
    const s = score([o.name, ...o.aliases]);
    if (s) out.push({ kind: "okrug", slug: o.slug, title: o.name, subtitle: "весь округ", s });
  }
  return out.sort((a, b) => b.s - a.s || a.title.localeCompare(b.title, "ru")).slice(0, limit)
    .map(({ s: _s, ...p }) => p);
}
