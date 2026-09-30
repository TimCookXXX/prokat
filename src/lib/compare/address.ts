// Адреса своего геокодера в «Где»: подсказка → место пользователя, подпись, «≈» и
// порядок ответов при наборе. Чистые функции — общие для WhereField, API и тестов.
// Сам поиск — src/lib/geocoder (сервер: src/server/geocoder.ts, браузер: мини-индекс).

import type { AddressHit } from "@/lib/geocoder/types";
import type { PointPrecision, UserLocation } from "@/lib/compare/geo";

export type { AddressHit } from "@/lib/geocoder/types";

/**
 * Точность подсказки для выдачи: `undefined` — точка дома из данных (здание, адресный узел
 * или интерполяция данных между соседними номерами) или объекта; `street` — номера нет в
 * данных («≈15», точка — оценка по соседям или улица) или точка дома в данных примерная;
 * `place` — только населённый пункт или микрорайон.
 */
export function hitPrecision(hit: Pick<AddressHit, "kind" | "precision">): PointPrecision | undefined {
  if (hit.kind === "place" || hit.precision === "place") return "place";
  if (hit.kind === "street" || hit.precision === "street") return "street";
  return undefined;
}

/** Подпись точности в списке и под полем; точный дом — null. */
export function precisionNote(p: PointPrecision | undefined): string | null {
  if (p === "street") return "≈ до улицы";
  if (p === "place") return "≈ населённый пункт";
  return null;
}

/**
 * Подпись места для поля и `la=`: «улица Базовская, 21к1, Яблоновский»; в главном
 * городе сайта — без города («улица Красная, 120»), у пункта — его название.
 */
export function hitLabel(hit: Pick<AddressHit, "kind" | "title" | "parts">, cityName: string): string {
  const place = hit.parts?.place ?? null;
  if (hit.kind === "place" || hit.kind === "poi" || !place || place === cityName) return hit.title;
  return `${hit.title}, ${place}`;
}

/** Выбранная подсказка → место пользователя: координаты уже в подсказке, второго запроса нет. */
export function hitToLocation(hit: AddressHit, cityName: string): Extract<UserLocation, { kind: "point" }> {
  const loc: Extract<UserLocation, { kind: "point" }> = {
    kind: "point", point: { lat: hit.lat, lon: hit.lon }, label: hitLabel(hit, cityName), source: "address",
  };
  const precision = hitPrecision(hit);
  if (precision) loc.precision = precision;
  return loc;
}

/** Подпись точки геолокации по обратному геокодеру: дом — адрес; улица — «рядом с …». */
export function reverseLabel(hit: Pick<AddressHit, "kind" | "title" | "parts"> | null, cityName: string): string | null {
  if (!hit) return null;
  if (hit.kind === "house" || hit.kind === "poi") return hitLabel(hit, cityName);
  return `рядом: ${hitLabel(hit, cityName)}`;
}

/** Есть ли в запросе номер: дома знает только сервер, улицы и пункты — и мини-индекс браузера. */
export function hasHouseNumber(q: string): boolean {
  return /\d/.test(q);
}

/**
 * Нужен ли запрос к серверу: всегда, если мини-индекса ещё нет; с ним — только когда
 * в запросе есть номер дома (без номера ответ сервера совпадает с мини-индексом).
 */
export function needsServer(q: string, clientReady: boolean): boolean {
  const t = q.trim();
  if (t.length < 2) return false;
  return !clientReady || hasHouseNumber(t);
}

/** Ответ сервера на подсказки: номер запроса по порядку и текст, на который он отвечает. */
export interface SuggestReply {
  seq: number;
  q: string;
  items: AddressHit[];
}

/**
 * Показывать ли пришедший ответ. Ответы приходят не по порядку: более старый, чем уже
 * показанный, — отбрасываем (список не откатывается назад); ответ на текст, от которого
 * человек уже ушёл (стёр или исправил), — тоже. Ответ на начало набираемого текста
 * показываем: он ближе к вводу, чем прошлый список, а точный догонит.
 */
export function shouldApply(reply: Pick<SuggestReply, "seq" | "q">, shownSeq: number, current: string): boolean {
  if (reply.seq <= shownSeq) return false;
  const cur = current.trim().toLowerCase();
  const q = reply.q.trim().toLowerCase();
  return cur === q || cur.startsWith(q);
}

/** Ключ подсказки для сверки клиентских и серверных списков (id у них разные). */
export function hitKey(hit: Pick<AddressHit, "title" | "subtitle">): string {
  return `${hit.title}|${hit.subtitle}`;
}

/**
 * Адреса без микрорайонов и округов справочника «Где»: их подсказывает matchPlaces (выше в
 * списке, ведут на выдачу по микрорайону с «≈ от центра»), а геокодер знает их тоже —
 * «Юбилейный — микрорайон» второй раз не показываем. `placeTitles` — названия справочника.
 */
export function withoutPlaceDuplicates(hits: AddressHit[], placeTitles: string[]): AddressHit[] {
  if (!placeTitles.length) return hits;
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
  const taken = new Set(placeTitles.map(norm));
  return hits.filter((h) => !(h.kind === "place" && taken.has(norm(h.title))));
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const extendsText = (prefix: string, text: string) => text.trim().toLowerCase().startsWith(prefix.trim().toLowerCase());

/**
 * Какие адреса показать под полем, пока человек печатает, — без мигания:
 *  - ответ сервера на этот самый текст — его;
 *  - есть мини-индекс — его подсказки (мгновенно), но если в запросе номер дома, а сервер уже
 *    ответил на начало текста («красная 1» при вводе «красная 12»), — дома сервера: не откатываемся
 *    к улицам на каждую цифру;
 *  - мини-индекса нет — прошлый ответ сервера, пока не пришёл новый (список не исчезает).
 */
export function visibleAddresses(
  q: string, server: Pick<SuggestReply, "q" | "items"> | null, clientHits: AddressHit[] | null,
): AddressHit[] {
  if (server && sameText(server.q, q)) return server.items;
  if (clientHits) {
    if (hasHouseNumber(q) && server && hasHouseNumber(server.q) && extendsText(server.q, q)) return server.items;
    return clientHits;
  }
  return server?.items ?? [];
}
