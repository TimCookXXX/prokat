// Запись разобранного CSV (lib/compare/offers-csv) в rental_shops + offers (ТЗ, п. 8.1).
// Всё в одной транзакции: либо файл лёг целиком, либо ничего (dryRun — всегда
// откат, но с точными счётчиками и отчётами).
//
// Прокат ищется в городе по названию (без учёта регистра и пробелов) и телефону;
// телефон не мешает совпадению, если у одной из сторон он не указан. У найденного
// проката дополняются только пустые поля — данные подтверждённой карточки не
// затираются. Микрорайон сверяется со справочником мест, адрес без координат
// геокодируется (если передан геокодер).
//
// Модель ищется через нормализацию и model_aliases; не нашлась — предложение
// относится к классу, исходное написание сохраняется, строка — в отчёт.
// Предложение — upsert по (прокат, класс, модель), но более старая проверка цены
// не заменяет более свежую.

import { and, eq, inArray, like, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  brands, cities, districts, itemClasses, itemGroups, modelAliases, offers, productModels, rentalShops,
} from "@db/schema";
import { newId } from "@/lib/id";
import { slugify } from "@/lib/slugify";
import type { OfferRow, RowError } from "@/lib/compare/offers-csv";
import { brandWordSet, compactWord, modelKey, offerModelKey, stopWordSet, type ModelKeyOptions } from "@/lib/compare/models";
import { okrugOfPoint, type GeoPoint } from "@/lib/compare/geo";

/** Адрес → координаты; null — не нашёлся. */
export type Geocode = (address: string, cityName: string) => Promise<GeoPoint | null>;

export interface ImportReport {
  shopsCreated: number;
  shopsMatched: number;
  offersCreated: number;
  offersUpdated: number;
  /** Строки, чья дата проверки старше уже записанной. */
  offersSkippedStale: number;
  errors: RowError[];
  /** Написания, которых нет в справочнике моделей: предложение привязано к классу. */
  unrecognizedModels: { line: number; model: string }[];
  /** Прокаты с адресом, у которых не получилось координат. */
  addressesWithoutCoords: { line: number; shop: string; address: string }[];
  /** Микрорайоны, которых нет в справочнике мест. */
  unknownMicrodistricts: { line: number; value: string }[];
  dryRun: boolean;
}

class Rollback extends Error {}

type Shop = typeof rentalShops.$inferSelect;
type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
type District = typeof districts.$inferSelect;
interface SeenShops { matched: Set<string>; created: Set<string> }

interface Context {
  /** (прокат, класс, ключ модели) → строка файла: разные написания одной модели — повтор. */
  seenOffers: Map<string, number>;
  tx: Tx;
  report: ImportReport;
  seen: SeenShops;
  geocode: Geocode | null;
  keyOpts: ModelKeyOptions;
  aliases: Map<string, { modelId: string; classId: string }>;
}

export function shopNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function importOffers(
  db: NodePgDatabase,
  rows: OfferRow[],
  { dryRun = false, geocode = null }: { dryRun?: boolean; geocode?: Geocode | null } = {},
): Promise<ImportReport> {
  const report: ImportReport = {
    shopsCreated: 0, shopsMatched: 0, offersCreated: 0, offersUpdated: 0, offersSkippedStale: 0,
    errors: [], unrecognizedModels: [], addressesWithoutCoords: [], unknownMicrodistricts: [], dryRun,
  };
  if (rows.length === 0) return report;

  try {
    await db.transaction(async (tx) => {
      const cityRows = await tx.select({ id: cities.id, slug: cities.slug, name: cities.name }).from(cities)
        .where(inArray(cities.slug, [...new Set(rows.map((r) => r.citySlug))]));
      const classRows = await tx.select({ id: itemClasses.id, slug: itemClasses.slug }).from(itemClasses)
        .where(inArray(itemClasses.slug, [...new Set(rows.map((r) => r.classSlug))]));
      const cityBySlug = new Map(cityRows.map((c) => [c.slug, c]));
      const classId = new Map(classRows.map((c) => [c.slug, c.id]));

      for (const r of rows) {
        if (!cityBySlug.has(r.citySlug)) report.errors.push({ line: r.line, message: `city_slug: города «${r.citySlug}» нет` });
        if (!classId.has(r.classSlug)) report.errors.push({ line: r.line, message: `class_slug: класса «${r.classSlug}» нет` });
      }
      if (report.errors.length) throw new Rollback();

      const ctx: Context = { seenOffers: new Map(), tx, report, seen: { matched: new Set(), created: new Set() }, geocode, ...(await loadModelLookup(tx)) };
      const shopsByCity = new Map<string, Shop[]>();
      const districtsByCity = new Map<string, District[]>();
      for (const r of rows) {
        const city = cityBySlug.get(r.citySlug)!;
        if (!shopsByCity.has(city.id)) {
          shopsByCity.set(city.id, await tx.select().from(rentalShops).where(eq(rentalShops.cityId, city.id)));
          districtsByCity.set(city.id, await tx.select().from(districts).where(eq(districts.cityId, city.id)));
        }
        const shop = await findOrCreateShop(ctx, shopsByCity.get(city.id)!, districtsByCity.get(city.id)!, city, r);
        await upsertOffer(ctx, shop.id, classId.get(r.classSlug)!, r);
      }
      if (report.errors.length) throw new Rollback();
      // Счётчики — по прокатам, а не по строкам файла.
      report.shopsCreated = ctx.seen.created.size;
      report.shopsMatched = ctx.seen.matched.size;

      if (dryRun) throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return report;
}

export interface ModelLookup {
  keyOpts: ModelKeyOptions;
  aliases: Map<string, { modelId: string; classId: string }>;
}

/** Всё, что нужно, чтобы узнать модель по написанию проката (импорт и кабинет проката). */
export async function loadModelLookup(tx: Tx | NodePgDatabase): Promise<ModelLookup> {
  // Внутри транзакции — по очереди: одно соединение не выполняет запросы параллельно.
  const brandRows = await tx.select({ name: brands.name, aliases: brands.aliases }).from(brands);
  const groupRows = await tx.select({ name: itemGroups.name }).from(itemGroups);
  const classRows = await tx.select({ name: itemClasses.name }).from(itemClasses);
  const aliasRows = await tx.select({ alias: modelAliases.alias, modelId: modelAliases.modelId, classId: productModels.itemClassId })
    .from(modelAliases).innerJoin(productModels, eq(productModels.id, modelAliases.modelId));
  return {
    keyOpts: { brandWords: brandWordSet(brandRows), stopWords: stopWordSet([...groupRows, ...classRows].map((r) => r.name)) },
    aliases: new Map(aliasRows.map((a) => [a.alias, { modelId: a.modelId, classId: a.classId }])),
  };
}

/** Микрорайон из файла → строка справочника: по названию, сокращению или slug. */
export function findMicrodistrict<D extends Pick<District, "kind" | "slug" | "name" | "aliases">>(value: string, list: D[]): D | null {
  // \b в JS не видит границ кириллических слов — отрезаем «мкр» по пробелам.
  const key = compactWord(value.replace(/(^|\s)(микрорайон|мкрн|мкр)\.?(?=\s|$)/gi, " "));
  return list.find((d) => d.kind === "microdistrict"
    && [d.slug, d.name, ...d.aliases].some((n) => compactWord(n) === key)) ?? null;
}

async function findOrCreateShop(
  ctx: Context, cityShops: Shop[], cityDistricts: District[], city: { id: string; name: string }, r: OfferRow,
): Promise<Shop> {
  const key = shopNameKey(r.shopName);
  const found = cityShops.find((s) =>
    shopNameKey(s.name) === key && (!s.phone || !r.phone || s.phone === r.phone));

  const micro = r.microdistrict ? findMicrodistrict(r.microdistrict, cityDistricts) : null;
  if (r.microdistrict && !micro) ctx.report.unknownMicrodistricts.push({ line: r.line, value: r.microdistrict });

  // Координаты: из файла; нет — у найденного проката уже есть; нет — геокодер по адресу.
  let point: GeoPoint | null = r.lat != null && r.lon != null ? { lat: r.lat, lon: r.lon } : null;
  if (!point && found?.lat != null && found.lon != null) point = { lat: found.lat, lon: found.lon };
  const address = r.address ?? found?.address ?? null;
  if (!point && address) {
    point = ctx.geocode ? await ctx.geocode(address, city.name).catch(() => null) : null;
    if (!point) ctx.report.addressesWithoutCoords.push({ line: r.line, shop: r.shopName, address });
  }
  const okrugSlug = point ? okrugOfPoint(point) : null;
  const okrugId = micro?.parentId
    ?? (okrugSlug ? cityDistricts.find((d) => d.kind === "okrug" && d.slug === okrugSlug)?.id ?? null : null);

  if (found) {
    // Созданный этим же файлом прокат не считается ещё и «найденным».
    if (!ctx.seen.created.has(found.id)) ctx.seen.matched.add(found.id);
    const patch: Partial<Shop> = {};
    if (!found.phone && r.phone) patch.phone = r.phone;
    if (!found.telegram && r.telegram) patch.telegram = r.telegram;
    if (!found.microdistrictId && micro) patch.microdistrictId = micro.id;
    if (!found.okrugId && okrugId) patch.okrugId = okrugId;
    if (!found.address && r.address) patch.address = r.address;
    if (found.lat == null && point) { patch.lat = point.lat; patch.lon = point.lon; }
    if (!found.hours && r.hours) patch.hours = r.hours;
    if (!found.website && r.website) patch.website = r.website;
    if (r.sourceUrl && !found.sourceUrls.includes(r.sourceUrl)) patch.sourceUrls = [...found.sourceUrls, r.sourceUrl];
    if (Object.keys(patch).length) {
      await ctx.tx.update(rentalShops).set({ ...patch, updatedAt: new Date() }).where(eq(rentalShops.id, found.id));
      Object.assign(found, patch);
    }
    return found;
  }

  const [created] = await ctx.tx.insert(rentalShops).values({
    id: newId(),
    cityId: city.id,
    slug: await freeShopSlug(ctx.tx, city.id, r.shopName),
    name: r.shopName,
    address: r.address,
    lat: point?.lat ?? null,
    lon: point?.lon ?? null,
    microdistrictId: micro?.id ?? null,
    okrugId,
    hours: r.hours,
    phone: r.phone,
    telegram: r.telegram,
    website: r.website,
    sourceUrls: r.sourceUrl ? [r.sourceUrl] : [],
  }).returning();
  ctx.seen.created.add(created.id);
  cityShops.push(created);
  return created;
}

async function freeShopSlug(tx: Tx, cityId: string, name: string): Promise<string> {
  const base = slugify(name) || "prokat";
  const taken = new Set((await tx.select({ slug: rentalShops.slug }).from(rentalShops)
    .where(and(eq(rentalShops.cityId, cityId), or(eq(rentalShops.slug, base), like(rentalShops.slug, `${base}-%`)))))
    .map((s) => s.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Модель предложения по написанию: модель справочника и ключ уникальности.
 * `wrongClass` — написание узнано, но модель из другого класса.
 */
export function resolveOfferModel(lookup: ModelLookup, model: string | null, itemClassId: string) {
  const raw = model ? modelKey(model, lookup.keyOpts) : null;
  const known = raw ? lookup.aliases.get(raw) : undefined;
  const wrongClass = !!known && known.classId !== itemClassId;
  const modelId = known && !wrongClass ? known.modelId : null;
  return { modelId, modelKey: offerModelKey(modelId, raw), recognized: !!known, wrongClass };
}

async function upsertOffer(ctx: Context, shopId: string, itemClassId: string, r: OfferRow) {
  const m = resolveOfferModel(ctx, r.model, itemClassId);
  if (m.wrongClass) {
    ctx.report.errors.push({ line: r.line, message: `model: «${r.model}» в справочнике относится к другому классу` });
    return;
  }
  if (r.model && !m.recognized) ctx.report.unrecognizedModels.push({ line: r.line, model: r.model });
  const { modelId, modelKey: key } = m;
  const seenKey = `${shopId}|${itemClassId}|${key}`;
  const prev = ctx.seenOffers.get(seenKey);
  if (prev) {
    ctx.report.errors.push({ line: r.line, message: `повтор строки ${prev}: тот же прокат, класс и модель («${r.model ?? "без модели"}»)` });
    return;
  }
  ctx.seenOffers.set(seenKey, r.line);

  const fields = {
    modelId,
    model: r.model,
    modelKey: key,
    includes: r.includes,
    priceDay: r.priceDay,
    priceWeek: r.priceWeek,
    minDays: r.minDays,
    depositRub: r.depositRub,
    depositDocument: r.depositDocument,
    deliveryAvailable: r.deliveryAvailable,
    deliveryPrice: r.deliveryPrice,
    deliveryFreeFrom: r.deliveryFreeFrom,
    deliverySameDay: r.deliverySameDay,
    verifiedAt: r.verifiedAt,
    verifiedBy: r.verifiedBy,
    sourceUrl: r.sourceUrl,
    isActive: true,
  };
  const [existing] = await ctx.tx.select({ id: offers.id, verifiedAt: offers.verifiedAt }).from(offers)
    .where(and(eq(offers.shopId, shopId), eq(offers.itemClassId, itemClassId), eq(offers.modelKey, key)))
    .limit(1);

  if (!existing) {
    await ctx.tx.insert(offers).values({ id: newId(), shopId, itemClassId, ...fields });
    ctx.report.offersCreated++;
    return;
  }
  if (existing.verifiedAt > r.verifiedAt) {
    ctx.report.offersSkippedStale++;
    return;
  }
  await ctx.tx.update(offers).set({ ...fields, updatedAt: new Date() }).where(eq(offers.id, existing.id));
  ctx.report.offersUpdated++;
}
