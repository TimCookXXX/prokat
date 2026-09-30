// Общие параметры /api/geo/*: город и точка.
import type { GeoPoint } from "@/lib/compare/geo";

/** Слаг города из запроса; по умолчанию — Краснодар; мусор — null. */
export function parseCity(raw: string | null): string | null {
  const city = raw ?? "krasnodar";
  return /^[a-z-]{2,40}$/.test(city) ? city : null;
}

function coord(lat: number, lon: number): GeoPoint | null {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** «45.03,38.97» → точка; нет или мусор — null. */
export function parseNear(raw: string | null): GeoPoint | null {
  const m = raw ? /^(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)$/.exec(raw) : null;
  return m ? coord(Number(m[1]), Number(m[2])) : null;
}

/** lat и lon отдельными параметрами. */
export function parsePoint(lat: string | null, lon: string | null): GeoPoint | null {
  const re = /^-?\d{1,3}(?:\.\d{1,8})?$/;
  return lat && lon && re.test(lat) && re.test(lon) ? coord(Number(lat), Number(lon)) : null;
}
