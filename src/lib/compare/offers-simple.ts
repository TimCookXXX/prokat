// Простой шаблон сбора цен (docs/inrenta-pivot/data/prokaty.template.csv): колонки
// по-русски, значения — как пишет человек. Нашёл прокат — строка: «Прокат, Адрес,
// Телефон, Что сдают, Модель, Цена за сутки…». Следующие вещи того же проката —
// строки с пустым «Прокат»: адрес, телефон, часы и ссылка берутся из строки выше.
//
// Разбор даёт те же OfferRow, что и полный шаблон (offers-csv.ts), — дальше
// общий импорт. Что за вещь, определяет поиск сайта: «моющий пылесос», «Puzzi»,
// «перфоратор sds-max»; модель из справочника сама указывает класс.

import { CATALOG } from "@/lib/compare/catalog-data";
import { BRANDS, MODELS } from "@/lib/compare/models-data";
import { brandWordSet, modelAliasKeys, stopWordSet } from "@/lib/compare/models";
import { buildSearchIndex, resolveQuery, type SearchData, type SearchTarget } from "@/lib/compare/search";
import { parseHours } from "@/lib/compare/hours";
import {
  detectDelimiter, normalizePhone, parseCsv, parseOffersCsv,
  type CsvRecord, type OfferRow, type ParseResult, type VerifiedBy,
} from "@/lib/compare/offers-csv";
import { slugify } from "@/lib/slugify";

type Field =
  | "shop" | "address" | "phone" | "what" | "model" | "priceDay" | "priceWeek" | "minDays" | "deposit"
  | "includes" | "hours" | "link" | "checked" | "microdistrict" | "city" | "telegram" | "notes";

/** Названия колонок (без регистра, «ё», знаков препинания) → поле. */
const HEADERS: Record<string, Field> = {
  "прокат": "shop", "название": "shop", "название проката": "shop",
  "адрес": "address",
  "телефон": "phone",
  "что": "what", "что сдают": "what", "вещь": "what", "инструмент": "what",
  "модель": "model",
  "цена за сутки": "priceDay", "цена сутки": "priceDay", "сутки": "priceDay", "цена": "priceDay",
  "цена за неделю": "priceWeek", "цена неделя": "priceWeek", "неделя": "priceWeek",
  "минимум суток": "minDays", "мин срок": "minDays", "минимальный срок": "minDays", "от суток": "minDays",
  "залог": "deposit",
  "в комплекте": "includes", "что входит": "includes",
  "часы работы": "hours", "часы": "hours", "режим работы": "hours",
  "ссылка": "link", "источник": "link", "сайт": "link",
  "проверено": "checked", "дата проверки": "checked", "дата": "checked",
  "микрорайон": "microdistrict", "район": "microdistrict",
  "город": "city",
  "телеграм": "telegram", "telegram": "telegram",
  "заметки": "notes", "комментарий": "notes",
};

/** Колонки проката: у строки с пустым «Прокат» берутся из строки выше. */
const SHOP_FIELDS: Field[] = ["address", "phone", "hours", "link", "checked", "microdistrict", "city", "telegram"];

const TEMPLATE_MARKER = /^пример(\s|$)/i;

function headerKey(v: string): string {
  return v.trim().toLowerCase().replace(/ё/g, "е").replace(/[.,:()₽]/g, " ").replace(/\s+/g, " ").trim();
}

/** Простой шаблон — если в заголовке есть колонка «Прокат» или «Название». */
export function isSimpleHeader(cells: string[]): boolean {
  return cells.some((c) => HEADERS[headerKey(c)] === "shop");
}

class RowProblem extends Error {}

// ------------------------------------------------------------ значения

function text(v: string | undefined): string | null {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
}

/** «1 000», «1000 ₽», «1000р», «1000 руб.» → 1000. */
export function parseRub(v: string, column: string): number | null {
  const t = v.toLowerCase().replace(/[\s ]/g, "").replace(/(₽|руб(лей|ля|ль)?|р)\.?$/, "");
  if (t === "") return null;
  if (!/^\d+$/.test(t) || Number(t) < 1) throw new RowProblem(`${column}: «${v.trim()}» — нужна цена в рублях, например 1000`);
  return Number(t);
}

/** Залог: пусто — уточняется; «нет», «без залога», «0» — без денежного; «паспорт»; «3000»; «3000 + паспорт». */
export function parseDeposit(v: string): { rub: number | null; document: boolean } {
  const t = v.trim().toLowerCase();
  if (t === "") return { rub: null, document: false };
  const document = /паспорт|документ|права/.test(t);
  const digits = t.replace(/[\s ]/g, "").match(/\d+/g);
  if (digits && digits.length === 1) return { rub: Number(digits[0]), document };
  if (!digits && (document || /^(нет|без( залога)?|не нужен|не берут|-|—)$/.test(t))) return { rub: 0, document };
  throw new RowProblem(`Залог: «${v.trim()}» — напишите сумму (3000), «нет», «паспорт» или «3000 + паспорт»`);
}

function parseMinDays(v: string): number {
  const t = v.trim();
  if (t === "") return 1;
  const m = /^(от\s*)?(\d+)\s*(сут[а-яё]*|дн[а-яё]*|день)?$/i.exec(t);
  if (!m || Number(m[2]) < 1) throw new RowProblem(`Минимум суток: «${t}» — нужно число, например 2`);
  return Number(m[2]);
}

/** «26.09.2026», «26.09.26», «26.09», «2026-09-26»; пусто — сегодня. */
export function parseCheckedDate(v: string, today: string): string {
  const t = v.trim();
  if (t === "") return today;
  let y: number, mo: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const ru = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?$/.exec(t);
  if (iso) [y, mo, d] = [+iso[1], +iso[2], +iso[3]];
  else if (ru) [d, mo, y] = [+ru[1], +ru[2], ru[3] ? (ru[3].length === 2 ? 2000 + +ru[3] : +ru[3]) : +today.slice(0, 4)];
  else throw new RowProblem(`Проверено: «${t}» — дата вида 26.09.2026`);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) throw new RowProblem(`Проверено: «${t}» — нет такой даты`);
  const out = date.toISOString().slice(0, 10);
  if (out > today) throw new RowProblem(`Проверено: ${t} — дата в будущем`);
  return out;
}

function link(v: string): { sourceUrl: string | null; telegram: string | null; verifiedBy: VerifiedBy } {
  const t = v.trim();
  if (t === "") return { sourceUrl: null, telegram: null, verifiedBy: "call" };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    throw new RowProblem(`Ссылка: «${t}» — не ссылка`);
  }
  if (!u.hostname.includes(".")) throw new RowProblem(`Ссылка: «${t}» — не ссылка`);
  const host = u.hostname.replace(/^www\./, "");
  const tg = host === "t.me" ? /^\/([A-Za-z0-9_]{4,64})\/?$/.exec(u.pathname)?.[1] ?? null : null;
  const listing = /(^|\.)(avito\.ru|youla\.ru|farpost\.ru)$/.test(host);
  return { sourceUrl: u.toString(), telegram: tg, verifiedBy: listing ? "listing" : "site" };
}

// ------------------------------------------------------------ что за вещь

type WhatResolver = (what: string | null, model: string | null) => { classSlug: string } | { error: string };

let defaultResolver: WhatResolver | undefined;

/** «Что сдают» и «Модель» → класс сравнения, по справочнику и поиску сайта. */
export function catalogResolver(): WhatResolver {
  if (defaultResolver) return defaultResolver;
  const keyOpts = {
    brandWords: brandWordSet(BRANDS),
    stopWords: stopWordSet(CATALOG.flatMap((c) => c.groups.flatMap((g) => [g.name, ...g.classes.map((cl) => cl.name)]))),
  };
  const groups = CATALOG.flatMap((c) => c.groups.map((g) => ({ ...g, category: c.name })));
  const data: SearchData = {
    groups: groups.map((g) => ({
      slug: g.slug, name: g.name, nameGenitive: g.nameGenitive, category: g.category, keywords: g.keywords ?? [],
      shops: 1, fromPrice: null,
      classes: g.classes.map((c) => ({ slug: c.slug, name: c.name, shortHint: c.shortHint ?? null, keywords: c.keywords, chip: c.chip ?? null })),
    })),
    brands: BRANDS,
    models: MODELS.map((m) => ({
      slug: m.slug, brand: m.brand, name: m.name, family: m.family ?? null,
      aliases: modelAliasKeys(m, BRANDS.find((b) => b.slug === m.brand)!, keyOpts),
      classSlug: m.cls,
      groupSlug: groups.find((g) => g.classes.some((c) => c.slug === m.cls))!.slug,
      shops: 1, fromDay: null,
    })),
  };
  const index = buildSearchIndex(data);
  const classSlugs = new Set(groups.flatMap((g) => g.classes.map((c) => c.slug)));
  const classesOf = (t: SearchTarget) => (t.classSlug
    ? [t.classSlug]
    : groups.find((g) => g.slug === t.groupSlug)?.classes.map((c) => c.slug) ?? []);
  const nameOf = (slug: string) => groups.flatMap((g) => g.classes).find((c) => c.slug === slug)?.name ?? slug;

  defaultResolver = (what, model) => {
    // Модель из справочника точнее слов: «Makita HR2470» — это SDS-plus.
    if (model) {
      const r = resolveQuery(index, model, data);
      if (r.level === "model" && classesOf(r.target).length === 1) return { classSlug: classesOf(r.target)[0] };
    }
    if (!what) return { error: model ? `Что сдают: пусто, а модель «${model}» не из справочника — напишите, что это (например, «перфоратор sds-plus»)` : "Что сдают: пусто" };
    if (classSlugs.has(what.toLowerCase())) return { classSlug: what.toLowerCase() };
    const r = resolveQuery(index, what, data);
    if (r.level === "none") return { error: `Что сдают: «${what}» — такого нет в каталоге сайта` };
    const options = r.level === "ambiguous"
      ? [...new Set(r.chips.flatMap((c) => classesOf(c.target)))]
      : classesOf(r.target);
    if (options.length === 1) return { classSlug: options[0] };
    return { error: `Что сдают: «${what}» — уточните: ${options.map(nameOf).join(" или ")}` };
  };
  return defaultResolver;
}

// ------------------------------------------------------------ строки

/** Простой шаблон → строки предложений. `records` — с заголовком. */
export function parseSimpleRecords(
  records: CsvRecord[], today: string, resolve: WhatResolver = catalogResolver(),
): ParseResult {
  const [header, ...data] = records;
  const fields = header.cells.map((c) => HEADERS[headerKey(c)] ?? null);
  const unknown = header.cells.filter((c, i) => c.trim() !== "" && !fields[i]);
  if (unknown.length) return { rows: [], errors: [{ line: 1, message: `Неизвестные колонки: ${unknown.join(", ")}` }] };
  if (!fields.includes("priceDay") && !fields.includes("priceWeek")) {
    return { rows: [], errors: [{ line: 1, message: "Нет колонки «Цена за сутки» или «Цена за неделю»" }] };
  }
  if (!fields.includes("what") && !fields.includes("model")) {
    return { rows: [], errors: [{ line: 1, message: "Нет колонки «Что сдают» или «Модель»" }] };
  }

  const rows: OfferRow[] = [];
  const errors: ParseResult["errors"] = [];
  const seen = new Map<string, number>();
  let shop: Partial<Record<Field, string>> | null = null;

  for (const rec of data) {
    const cell: Partial<Record<Field, string>> = {};
    fields.forEach((f, i) => { if (f && (rec.cells[i] ?? "").trim() !== "") cell[f] = rec.cells[i]; });
    if (Object.keys(cell).length === 0 || (Object.keys(cell).length === 1 && cell.notes)) continue;
    try {
      // Пустой «Прокат» — ещё одна вещь проката из строки выше.
      if (cell.shop) shop = cell;
      else if (!shop) throw new RowProblem("Прокат: пусто — укажите название проката");
      else for (const f of SHOP_FIELDS) if (cell[f] === undefined && shop[f] !== undefined) cell[f] = shop[f];
      const shopName = text(shop.shop)!;
      if (TEMPLATE_MARKER.test(shopName)) continue; // строки-примеры из шаблона
      if (shopName.length > 200) throw new RowProblem("Прокат: длиннее 200 символов");

      const model = text(cell.model);
      if (model && model.length > 120) throw new RowProblem("Модель: длиннее 120 символов");
      const what = resolve(text(cell.what), model);
      if ("error" in what) throw new RowProblem(what.error);

      const rawPhone = text(cell.phone);
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      if (rawPhone && !phone) throw new RowProblem(`Телефон: «${rawPhone}» — не российский номер`);

      const priceDay = parseRub(cell.priceDay ?? "", "Цена за сутки");
      const priceWeek = parseRub(cell.priceWeek ?? "", "Цена за неделю");
      if (priceDay === null && priceWeek === null) throw new RowProblem("Цена за сутки: пусто");

      let hours: OfferRow["hours"];
      try {
        hours = parseHours(cell.hours ?? "");
      } catch (e) {
        throw new RowProblem(`Часы работы: ${(e as Error).message.replace(/^часы: /, "")}`);
      }

      const deposit = parseDeposit(cell.deposit ?? "");
      const src = link(cell.link ?? "");
      const rawTelegram = text(cell.telegram)?.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "") ?? null;
      if (rawTelegram && !/^[A-Za-z0-9_]{4,64}$/.test(rawTelegram)) throw new RowProblem(`Телеграм: «${cell.telegram}» — ожидается @username`);
      const microdistrict = text(cell.microdistrict);
      if (microdistrict && microdistrict.length > 80) throw new RowProblem("Микрорайон: длиннее 80 символов");

      const row: OfferRow = {
        line: rec.line,
        citySlug: cell.city ? slugify(cell.city) : "krasnodar",
        shopName,
        microdistrict,
        address: text(cell.address),
        lat: null,
        lon: null,
        hours,
        telegram: rawTelegram ?? src.telegram,
        phone,
        website: null,
        classSlug: what.classSlug,
        model,
        includes: text(cell.includes),
        priceDay,
        priceWeek,
        minDays: parseMinDays(cell.minDays ?? ""),
        depositRub: deposit.rub,
        depositDocument: deposit.document,
        deliveryAvailable: false,
        deliveryPrice: 0,
        deliveryFreeFrom: null,
        deliverySameDay: false,
        verifiedAt: parseCheckedDate(cell.checked ?? "", today),
        verifiedBy: src.verifiedBy,
        sourceUrl: src.sourceUrl,
      };
      const key = [row.citySlug, shopName.toLowerCase(), phone ?? "", row.classSlug, model?.toLowerCase() ?? ""].join("|");
      const prev = seen.get(key);
      if (prev) throw new RowProblem(`повтор строки ${prev}: тот же прокат, вещь и модель`);
      seen.set(key, rec.line);
      rows.push(row);
    } catch (e) {
      if (!(e instanceof RowProblem)) throw e;
      errors.push({ line: rec.line, message: e.message });
    }
  }
  return { rows, errors };
}

/** Файл цен любого из двух шаблонов: простой (русские колонки) или полный. */
export function parseOffersFile(csv: string, today: string): ParseResult {
  let records: CsvRecord[];
  try {
    records = parseCsv(csv, detectDelimiter(csv));
  } catch (e) {
    return { rows: [], errors: [{ line: 0, message: (e as Error).message }] };
  }
  if (records.length === 0) return { rows: [], errors: [{ line: 0, message: "Файл пуст" }] };
  return isSimpleHeader(records[0].cells) ? parseSimpleRecords(records, today) : parseOffersCsv(csv, today);
}
