// Разбор CSV со сбором цен (docs/inrenta-pivot/data/offers.template.csv) в
// нормализованные строки предложений. Чистые функции без БД: запись — в
// server/compare/import-offers. Ошибки копятся со строкой файла, чтобы таблицу
// можно было поправить за один проход.

import { verifiedBy, type WeekHours } from "@db/schema";
import { parseHours } from "@/lib/compare/hours";

export type VerifiedBy = (typeof verifiedBy.enumValues)[number];

export interface OfferRow {
  /** Строка файла (заголовок — строка 1). */
  line: number;
  citySlug: string;
  shopName: string;
  /** Микрорайон как в файле: «ФМР», «Фестивальный» — сверяется со справочником мест. */
  microdistrict: string | null;
  address: string | null;
  /** Координаты адреса, если известны; иначе импорт геокодирует адрес. */
  lat: number | null;
  lon: number | null;
  hours: WeekHours | null;
  telegram: string | null;
  /** +7XXXXXXXXXX */
  phone: string | null;
  website: string | null;
  classSlug: string;
  model: string | null;
  /** Что входит в аренду: «моющее средство», «2 бура». */
  includes: string | null;
  /** null — только недельный тариф. */
  priceDay: number | null;
  priceWeek: number | null;
  minDays: number;
  /** null — залог неизвестен («уточняется»), 0 — денежного залога нет. */
  depositRub: number | null;
  depositDocument: boolean;
  deliveryAvailable: boolean;
  deliveryPrice: number;
  deliveryFreeFrom: number | null;
  deliverySameDay: boolean;
  /** YYYY-MM-DD */
  verifiedAt: string;
  verifiedBy: VerifiedBy;
  sourceUrl: string | null;
}

export interface RowError {
  line: number;
  message: string;
}

export const OFFER_COLUMNS = [
  "city_slug", "shop_name", "microdistrict", "address", "lat", "lon", "hours", "phone", "telegram", "website",
  "class_slug", "model", "includes", "price_day", "price_week", "min_days",
  "deposit_rub", "deposit_document",
  "delivery_available", "delivery_price", "delivery_free_from", "delivery_same_day",
  "verified_at", "verified_by", "source_url",
] as const;

type Column = (typeof OFFER_COLUMNS)[number];

/** Старые названия колонок, которые ещё понимаем. */
const COLUMN_ALIASES: Record<string, Column> = { district: "microdistrict" };

// price_day может быть пустым у понедельного проката, но колонка в файле нужна.
const REQUIRED_COLUMNS: Column[] = ["city_slug", "shop_name", "class_slug", "price_day", "verified_at"];

/** Строки-примеры из шаблона не должны попасть в базу как настоящие прокаты. */
const TEMPLATE_MARKER = /^пример(\s|$)/i;

// ------------------------------------------------------------------ CSV

export interface CsvRecord {
  line: number;
  cells: string[];
}

/**
 * RFC 4180: запятая-разделитель, кавычки с удвоением внутри, переводы строк
 * внутри кавычек, CRLF/LF, BOM в начале. Пустые строки пропускаются.
 */
export function parseCsv(text: string): CsvRecord[] {
  const src = text.replace(/^﻿/, "");
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cell);
    if (!(cells.length === 1 && cells[0].trim() === "")) records.push({ line: recordLine, cells });
    cells = [];
    cell = "";
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") { cells.push(cell); cell = ""; }
    else if (ch === "\r") { /* CRLF: запись закроет \n */ }
    else if (ch === "\n") { endRecord(); line++; recordLine = line; }
    else cell += ch;
  }
  if (inQuotes) throw new Error(`Незакрытая кавычка (строка ${recordLine})`);
  if (cell !== "" || cells.length > 0) endRecord();
  return records;
}

// ------------------------------------------------------------ нормализация

/** Российский номер → +7XXXXXXXXXX; null, если это не номер. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) return `+7${digits.slice(1)}`;
  if (digits.length === 10 && digits[0] === "9") return `+7${digits}`;
  return null;
}

class RowProblem extends Error {}

function text(v: string): string | null {
  const t = v.trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
}

function int(v: string, column: string, { min }: { min: number }): number | null {
  const t = v.replace(/[\s ₽]/g, "");
  if (t === "") return null;
  if (!/^\d+$/.test(t)) throw new RowProblem(`${column}: «${v}» — не целое число рублей/суток`);
  const n = Number(t);
  if (n < min) throw new RowProblem(`${column}: должно быть не меньше ${min}`);
  return n;
}

function bool(v: string, column: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (t === "") return null;
  if (["true", "1", "да", "yes"].includes(t)) return true;
  if (["false", "0", "нет", "no"].includes(t)) return false;
  throw new RowProblem(`${column}: «${v}» — ожидается true/false`);
}

function coord(v: string, column: string, [min, max]: [number, number]): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  if (!/^-?\d+(\.\d+)?$/.test(t) || n < min || n > max) throw new RowProblem(`${column}: «${v}» — не координата`);
  return n;
}

function telegram(v: string): string | null {
  const t = v.trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
  if (t === "") return null;
  if (!/^[A-Za-z0-9_]{4,64}$/.test(t)) throw new RowProblem(`telegram: «${v}» — ожидается @username или ссылка t.me`);
  return t;
}

function url(v: string, column: string): string | null {
  const t = v.trim();
  if (t === "") return null;
  try {
    const u = new URL(t);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch { /* ниже */ }
  throw new RowProblem(`${column}: «${v}» — не http(s)-ссылка`);
}

function isoDate(v: string, column: string, today: string): string {
  const t = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new RowProblem(`${column}: «${v}» — дата в формате ГГГГ-ММ-ДД`);
  }
  if (t > today) throw new RowProblem(`${column}: ${t} — дата проверки в будущем`);
  return t;
}

// ----------------------------------------------------------------- строки

export interface ParseResult {
  rows: OfferRow[];
  errors: RowError[];
}

/** @param today YYYY-MM-DD — дата проверки не может быть позже. */
export function parseOffersCsv(csv: string, today: string): ParseResult {
  let records: CsvRecord[];
  try {
    records = parseCsv(csv);
  } catch (e) {
    return { rows: [], errors: [{ line: 0, message: (e as Error).message }] };
  }
  if (records.length === 0) return { rows: [], errors: [{ line: 0, message: "Файл пуст" }] };

  const [header, ...data] = records;
  const names = header.cells.map((c) => c.trim().toLowerCase()).map((n) => COLUMN_ALIASES[n] ?? n);
  const known = new Set<string>(OFFER_COLUMNS);
  const errors: RowError[] = [];
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length) errors.push({ line: 1, message: `Неизвестные колонки: ${unknown.join(", ")}` });
  const missing = REQUIRED_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) errors.push({ line: 1, message: `Нет обязательных колонок: ${missing.join(", ")}` });
  if (errors.length) return { rows: [], errors };

  const index = new Map(names.map((n, i) => [n, i]));
  const rows: OfferRow[] = [];
  const seen = new Map<string, number>();

  for (const rec of data) {
    const get = (c: Column) => {
      const i = index.get(c);
      return i === undefined ? "" : (rec.cells[i] ?? "");
    };
    try {
      if (rec.cells.length > names.length) throw new RowProblem(`ячеек ${rec.cells.length}, а колонок ${names.length}`);
      const row = toRow(rec.line, get, today);
      const key = [row.citySlug, row.shopName.toLowerCase(), row.phone ?? "", row.classSlug, row.model?.toLowerCase() ?? ""].join("|");
      const prev = seen.get(key);
      if (prev) throw new RowProblem(`повтор строки ${prev}: тот же прокат, класс и модель`);
      seen.set(key, rec.line);
      rows.push(row);
    } catch (e) {
      if (!(e instanceof RowProblem)) throw e;
      errors.push({ line: rec.line, message: e.message });
    }
  }
  return { rows, errors };
}

function toRow(line: number, get: (c: Column) => string, today: string): OfferRow {
  const citySlug = text(get("city_slug"));
  const shopName = text(get("shop_name"));
  const classSlug = text(get("class_slug"));
  if (!citySlug) throw new RowProblem("city_slug: пусто");
  if (!shopName) throw new RowProblem("shop_name: пусто");
  if (!classSlug) throw new RowProblem("class_slug: пусто");
  if (TEMPLATE_MARKER.test(shopName)) throw new RowProblem(`shop_name: «${shopName}» — строка-пример из шаблона`);
  // Длины — как у колонок БД: длинное значение иначе уронит импорт без номера строки.
  for (const [col, max] of [["shop_name", 200], ["model", 120], ["microdistrict", 80]] as const) {
    if (get(col).trim().length > max) throw new RowProblem(`${col}: длиннее ${max} символов`);
  }

  const rawPhone = get("phone").trim();
  const phone = rawPhone === "" ? null : normalizePhone(rawPhone);
  if (rawPhone !== "" && !phone) throw new RowProblem(`phone: «${rawPhone}» — не российский номер`);

  const priceDay = int(get("price_day"), "price_day", { min: 1 });
  const priceWeek = int(get("price_week"), "price_week", { min: 1 });
  if (priceDay === null && priceWeek === null) throw new RowProblem("price_day: пусто, и нет price_week");

  const deliveryAvailable = bool(get("delivery_available"), "delivery_available") ?? false;
  const deliveryPrice = int(get("delivery_price"), "delivery_price", { min: 0 });
  const deliveryFreeFrom = int(get("delivery_free_from"), "delivery_free_from", { min: 1 });
  const deliverySameDay = bool(get("delivery_same_day"), "delivery_same_day") ?? false;
  if (!deliveryAvailable && (deliveryPrice || deliveryFreeFrom !== null || deliverySameDay)) {
    throw new RowProblem("доставка: заданы условия, а delivery_available=false");
  }

  const rawVerifiedBy = get("verified_by").trim().toLowerCase();
  const verifiedByValues = verifiedBy.enumValues as readonly string[];
  if (rawVerifiedBy !== "" && !verifiedByValues.includes(rawVerifiedBy)) {
    throw new RowProblem(`verified_by: «${rawVerifiedBy}» — одно из ${verifiedByValues.join(", ")}`);
  }

  const lat = coord(get("lat"), "lat", [-90, 90]);
  const lon = coord(get("lon"), "lon", [-180, 180]);
  if ((lat === null) !== (lon === null)) throw new RowProblem("lat/lon: нужны обе координаты или ни одной");
  let hours: WeekHours | null;
  try {
    hours = parseHours(get("hours"));
  } catch (e) {
    throw new RowProblem((e as Error).message);
  }

  return {
    line,
    citySlug: citySlug.toLowerCase(),
    shopName,
    microdistrict: text(get("microdistrict")),
    address: text(get("address")),
    lat,
    lon,
    hours,
    telegram: telegram(get("telegram")),
    phone,
    website: url(get("website"), "website"),
    classSlug: classSlug.toLowerCase(),
    model: text(get("model")),
    includes: text(get("includes")),
    priceDay,
    priceWeek,
    minDays: int(get("min_days"), "min_days", { min: 1 }) ?? 1,
    depositRub: int(get("deposit_rub"), "deposit_rub", { min: 0 }),
    depositDocument: bool(get("deposit_document"), "deposit_document") ?? false,
    deliveryAvailable,
    deliveryPrice: deliveryPrice ?? 0,
    deliveryFreeFrom,
    deliverySameDay,
    verifiedAt: isoDate(get("verified_at"), "verified_at", today),
    verifiedBy: (rawVerifiedBy || "call") as VerifiedBy,
    sourceUrl: url(get("source_url"), "source_url"),
  };
}
