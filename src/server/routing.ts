// Путь «до проката» по дорогам. Формула ТЗ (по прямой × ROUTE_FACTOR) не видит
// реку и мосты: из Яблоновского до ЮМР по прямой 3 км, по дорогам — 9–10.
//
// Маршрутизаторы — реализации Router, опрашиваются по цепочке:
//   1. Яндекс Матрица расстояний (YANDEX_ROUTING_API_KEY) — расстояние и время с
//      пробками, как на Яндекс Картах: цифры в карточке совпадут с картой;
//   2. свой OSRM (OSRM_URL; сервис osrm в docker-compose, граф — scripts/osrm/prepare.sh)
//      — расстояние по дорогам OpenStreetMap, время — по средней скорости города;
//   3. нет ни того, ни другого, сбой или лимит — по прямой, как раньше (в выдаче).
// Точки, которые не посчитал первый, досчитывает следующий.

import { getEnv } from "@/lib/env";
import { pointKey, type GeoPoint } from "@/lib/compare/geo";

export interface Route {
  km: number;
  /** Время в пути, мин (Яндекс — с пробками); null — посчитать по средней скорости. */
  minutes: number | null;
}

export interface Router {
  name: string;
  /** Сколько держать ответ в кэше: время с пробками устаревает быстрее, чем дороги. */
  ttlMs: number;
  /** Путь от `from` до каждой точки; null — маршрута нет. Сбой — исключение. */
  routes(from: GeoPoint, to: GeoPoint[]): Promise<(Route | null)[]>;
}

const TIMEOUT_MS = 2500;
const DAY_MS = 24 * 60 * 60 * 1000;

async function inChunks<T>(to: GeoPoint[], size: number, load: (part: GeoPoint[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < to.length; i += size) out.push(...(await load(to.slice(i, i + size))));
  return out;
}

/** Свой OSRM: сервис table, одна строка матрицы — от пользователя до всех прокатов. */
export function osrmRouter(baseUrl: string): Router {
  const base = baseUrl.replace(/\/+$/, "");
  const coord = (p: GeoPoint) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
  return {
    name: "osrm",
    ttlMs: DAY_MS,
    // --max-table-size в compose — 1000 точек за запрос.
    routes: (from, to) => inChunks(to, 500, async (part) => {
      const coords = [from, ...part].map(coord).join(";");
      const res = await fetch(`${base}/table/v1/driving/${coords}?sources=0&annotations=distance`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`osrm ${res.status}`);
      const data = (await res.json()) as { code?: string; distances?: (number | null)[][] };
      if (data.code !== "Ok" || !data.distances?.[0]) throw new Error(`osrm ${data.code}`);
      return data.distances[0].slice(1).map((m) => (m == null ? null : { km: m / 1000, minutes: null }));
    }),
  };
}

const YANDEX_MATRIX_URL = "https://api.routing.yandex.net/v2/distancematrix";

interface YandexMatrix {
  rows?: { elements?: { status?: string; distance?: { value?: number }; duration?: { value?: number } }[] }[];
  errors?: string[];
}

/**
 * Яндекс Матрица расстояний: одна точка отправления, до 100 назначений за запрос
 * (лимит матрицы — 100 элементов). Время — с пробками на момент запроса.
 */
export function yandexRouter(apiKey: string): Router {
  const coord = (p: GeoPoint) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`; // широта,долгота
  return {
    name: "yandex",
    ttlMs: 10 * 60 * 1000,
    routes: (from, to) => inChunks(to, 100, async (part) => {
      const params = new URLSearchParams({
        apikey: apiKey,
        origins: coord(from),
        destinations: part.map(coord).join("|"),
        mode: "driving",
        departure_time: String(Math.floor(Date.now() / 1000)),
      });
      const res = await fetch(`${YANDEX_MATRIX_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const data = (await res.json().catch(() => ({}))) as YandexMatrix;
      if (!res.ok) throw new Error(`yandex ${res.status}${data.errors?.length ? `: ${data.errors.join("; ")}` : ""}`);
      const elements = data.rows?.[0]?.elements;
      if (!elements || elements.length !== part.length) throw new Error("yandex: неожиданный ответ");
      return elements.map((e) => (e.status === "OK" && e.distance?.value != null
        ? { km: e.distance.value / 1000, minutes: e.duration?.value != null ? Math.round(e.duration.value / 60) : null }
        : null));
    }),
  };
}

let routers: Router[] | undefined;

/** Маршрутизаторы из env по порядку опроса; пусто — считаем по прямой. */
export function getRouters(): Router[] {
  if (routers) return routers;
  const env = getEnv();
  routers = [
    ...(env.YANDEX_ROUTING_API_KEY ? [yandexRouter(env.YANDEX_ROUTING_API_KEY)] : []),
    ...(env.OSRM_URL ? [osrmRouter(env.OSRM_URL)] : []),
  ];
  return routers;
}

// Кэш: те же пары точек повторяются между страницами и вкладками; срок — у маршрутизатора.
const CACHE_MAX = 50_000;
const cache = new Map<string, { until: number; route: Route | null }>();

function remember(key: string, route: Route | null, ttlMs: number) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: Date.now() + ttlMs, route });
}

/**
 * Пути по дорогам от точки пользователя до точек прокатов: ключ — pointKey точки
 * проката. Чего нет в ответе (все маршрутизаторы не смогли) — нет и в карте:
 * для этих прокатов выдача посчитает по прямой.
 */
export async function roadRoutes(
  from: GeoPoint, to: GeoPoint[], chain: Router[] = getRouters(),
): Promise<Map<string, Route>> {
  const result = new Map<string, Route>();
  const fromKey = pointKey(from);
  let todo: GeoPoint[] = [];
  const seen = new Set<string>();
  for (const p of to) {
    const k = pointKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const hit = cache.get(`${fromKey}>${k}`);
    if (hit && Date.now() < hit.until) {
      if (hit.route) result.set(k, hit.route);
    } else {
      todo.push(p);
    }
  }
  for (const r of chain) {
    if (!todo.length) break;
    try {
      const got = await r.routes(from, todo);
      const left: GeoPoint[] = [];
      todo.forEach((p, i) => {
        const route = got[i] ?? null;
        if (route) {
          result.set(pointKey(p), route);
          remember(`${fromKey}>${pointKey(p)}`, route, r.ttlMs);
        } else {
          left.push(p); // маршрута нет у этого — спросим следующий
        }
      });
      todo = left;
    } catch (e) {
      // Сбой не кэшируем: эти точки досчитает следующий маршрутизатор.
      console.error(`[routing] ${r.name}:`, (e as Error).message);
    }
  }
  return result;
}
