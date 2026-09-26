// Read-слой сравнения прокатов: группы и классы, предложения, прокаты.
// Телефоны прокатов наружу не отдаются — только через revealShopPhone (по клику).

import { and, asc, eq, gte, ilike, inArray, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import {
  brands, categories, cities, districts, itemClasses, itemGroups, modelAliases, offers, productModels, rentalShops,
} from "@db/schema";
import type { CompareOffer } from "@/lib/compare/view";
import type { SearchData } from "@/lib/compare/search";
import type { CityGeo } from "@/lib/compare/geo";
import { CATALOG } from "@/lib/compare/catalog-data";

export type ItemGroup = typeof itemGroups.$inferSelect;
export type ItemClass = typeof itemClasses.$inferSelect;
export interface PlaceRef { slug: string; name: string }

/** Прокат с его микрорайоном и округом (для подписи «≈ ФМР» и группировки по округу). */
export type RentalShop = typeof rentalShops.$inferSelect & {
  microdistrict: PlaceRef | null;
  okrug: PlaceRef | null;
};

// Микрорайон и округ проката — две ссылки на одну таблицу мест.
export const shopMd = alias(districts, "shop_md");
export const shopOkrug = alias(districts, "shop_okrug");
/** Колонки для select: `{ shop: rentalShops, ...shopPlaceCols }` + joinShopPlace(query). */
export const shopPlaceCols = {
  microdistrict: { slug: shopMd.slug, name: shopMd.name },
  okrug: { slug: shopOkrug.slug, name: shopOkrug.name },
};

export function withPlace(row: { shop: typeof rentalShops.$inferSelect; microdistrict: PlaceRef | null; okrug: PlaceRef | null }): RentalShop {
  return { ...row.shop, microdistrict: row.microdistrict, okrug: row.okrug };
}

export interface GroupWithClasses {
  group: ItemGroup;
  category: { id: string; slug: string; name: string };
  classes: ItemClass[];
}

export async function getGroupBySlug(slug: string): Promise<GroupWithClasses | null> {
  const db = getDb();
  const [row] = await db
    .select({ group: itemGroups, category: { id: categories.id, slug: categories.slug, name: categories.name } })
    .from(itemGroups)
    .innerJoin(categories, eq(categories.id, itemGroups.categoryId))
    .where(and(eq(itemGroups.slug, slug), eq(itemGroups.isActive, true)))
    .limit(1);
  if (!row) return null;
  const classes = await db.select().from(itemClasses)
    .where(and(eq(itemClasses.groupId, row.group.id), eq(itemClasses.isActive, true)))
    .orderBy(asc(itemClasses.sort));
  return { ...row, classes };
}

// Видимые предложения: прокат в городе и не скрыт, предложение активно.
const visible = (cityId: string) => and(
  eq(rentalShops.cityId, cityId),
  ne(rentalShops.status, "hidden"),
  eq(offers.isActive, true),
);

interface ModelRef { slug: string; name: string; brand: string; brandSlug: string }

/** Предложения с прокатом, его местом, моделью и брендом — в форме выдачи. */
async function offerRows(where: SQL | undefined): Promise<CompareOffer[]> {
  const rows = await getDb()
    .select({
      offer: offers, shop: rentalShops, ...shopPlaceCols,
      model: { slug: productModels.slug, name: productModels.name, brand: brands.name, brandSlug: brands.slug },
    })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .leftJoin(shopMd, eq(shopMd.id, rentalShops.microdistrictId))
    .leftJoin(shopOkrug, eq(shopOkrug.id, rentalShops.okrugId))
    .leftJoin(productModels, eq(productModels.id, offers.modelId))
    .leftJoin(brands, eq(brands.id, productModels.brandId))
    .where(where);
  return rows.map((r) => toCompareOffer(r.offer, withPlace(r), r.model?.slug ? (r.model as ModelRef) : null));
}

/** Предложения класса в городе. */
export async function getClassOffers(cityId: string, itemClassId: string): Promise<CompareOffer[]> {
  return offerRows(and(visible(cityId), eq(offers.itemClassId, itemClassId)));
}

/** Предложения всех классов группы в городе — страница группы показывает их вместе. */
export async function getGroupOffers(cityId: string, groupId: string): Promise<CompareOffer[]> {
  const classIds = getDb().select({ id: itemClasses.id }).from(itemClasses).where(eq(itemClasses.groupId, groupId));
  return offerRows(and(visible(cityId), inArray(offers.itemClassId, classIds)));
}

/** Предложения модели в городе (её семейство — та же модель). */
export async function getModelOffers(cityId: string, modelId: string): Promise<CompareOffer[]> {
  return offerRows(and(visible(cityId), eq(offers.modelId, modelId)));
}

export function toCompareOffer(o: typeof offers.$inferSelect, s: RentalShop, m: ModelRef | null = null): CompareOffer {
  return {
    id: o.id,
    shopId: s.id,
    shopSlug: s.slug,
    shopName: s.name,
    itemClassId: o.itemClassId,
    model: o.model,
    modelId: o.modelId,
    modelSlug: m?.slug ?? null,
    modelName: m ? `${m.brand} ${m.name}` : null,
    brandSlug: m?.brandSlug ?? null,
    includes: o.includes,
    district: s.microdistrict?.name ?? "",
    place: {
      microdistrict: s.microdistrict?.slug ?? null,
      okrug: s.okrug?.slug ?? null,
      lat: s.lat,
      lon: s.lon,
      address: s.address,
    },
    hours: s.hours,
    priceDay: o.priceDay,
    priceWeek: o.priceWeek,
    minDays: o.minDays,
    depositRub: o.depositRub,
    depositDocument: o.depositDocument,
    delivery: {
      available: o.deliveryAvailable,
      price: o.deliveryPrice,
      freeFrom: o.deliveryFreeFrom,
      sameDay: o.deliverySameDay,
    },
    verifiedAt: o.verifiedAt,
    verifiedBy: o.verifiedBy,
    claimed: s.status === "claimed",
  };
}

/** Число активных предложений по классам группы в городе. */
export async function getClassOfferCounts(cityId: string, classIds: string[]): Promise<Map<string, number>> {
  if (classIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ classId: offers.itemClassId, n: sql<number>`count(*)::int` })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .where(and(visible(cityId), inArray(offers.itemClassId, classIds)))
    .groupBy(offers.itemClassId);
  return new Map(rows.map((r) => [r.classId, r.n]));
}

export interface NavClass {
  slug: string;
  name: string;
  shortHint: string | null;
  keywords: string[];
  /** Уточнение для чипов при неоднозначном запросе — из справочника (catalog-data). */
  chip: string | null;
}

const CHIPS = new Map(CATALOG.flatMap((c) => c.groups.flatMap((g) => g.classes.map((cl) => [cl.slug, cl.chip ?? null] as const))));
export interface NavGroup {
  slug: string;
  name: string;
  nameGenitive: string;
  seoWord: "prokat" | "arenda";
  /** Синонимы для поиска. */
  keywords: string[];
  classes: NavClass[];
  /** Прокатов с актуальными ценами в городе. */
  shops: number;
  /** Самая низкая суточная цена в группе; у понедельных — недельная. */
  fromPrice: { rub: number; per: "day" | "week" } | null;
}
export interface NavCategory { slug: string; name: string; groups: NavGroup[] }

/**
 * Каталог сравнения для города: категории → группы → классы, с числом прокатов и
 * ценой «от». Цена «от» — только по свежим ценам (проверены не раньше freshSince):
 * устаревшая цена не должна выглядеть самой низкой. Группы без предложений тоже
 * возвращаются — вызывающий решает, показывать ли их (поиск — да, карточки — нет).
 */
export async function getCompareCatalog(cityId: string, freshSince: string): Promise<NavCategory[]> {
  const db = getDb();
  const rows = await db
    .select({
      category: { slug: categories.slug, name: categories.name },
      group: itemGroups,
      cls: itemClasses,
    })
    .from(itemClasses)
    .innerJoin(itemGroups, eq(itemGroups.id, itemClasses.groupId))
    .innerJoin(categories, eq(categories.id, itemGroups.categoryId))
    .where(and(eq(itemGroups.isActive, true), eq(itemClasses.isActive, true)))
    .orderBy(asc(itemGroups.sort), asc(itemClasses.sort));

  const stats = await db
    .select({
      groupId: itemClasses.groupId,
      shops: sql<number>`count(distinct ${offers.shopId})::int`,
      minDay: sql<number | null>`min(${offers.priceDay}) filter (where ${offers.verifiedAt} >= ${freshSince})`,
      minWeek: sql<number | null>`min(${offers.priceWeek}) filter (where ${offers.verifiedAt} >= ${freshSince})`,
    })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .innerJoin(itemClasses, eq(itemClasses.id, offers.itemClassId))
    .where(visible(cityId))
    .groupBy(itemClasses.groupId);
  const byGroup = new Map(stats.map((s) => [s.groupId, s]));

  const out: NavCategory[] = [];
  for (const r of rows) {
    let cat = out.find((c) => c.slug === r.category.slug);
    if (!cat) out.push(cat = { ...r.category, groups: [] });
    let g = cat.groups.find((x) => x.slug === r.group.slug);
    if (!g) {
      const st = byGroup.get(r.group.id);
      cat.groups.push(g = {
        slug: r.group.slug,
        name: r.group.name,
        nameGenitive: r.group.nameGenitive,
        seoWord: r.group.seoWord,
        keywords: r.group.searchKeywords,
        classes: [],
        shops: st?.shops ?? 0,
        fromPrice: st?.minDay != null ? { rub: st.minDay, per: "day" }
          : st?.minWeek != null ? { rub: st.minWeek, per: "week" } : null,
      });
    }
    g.classes.push({
      slug: r.cls.slug, name: r.cls.name, shortHint: r.cls.shortHint,
      keywords: r.cls.searchKeywords, chip: CHIPS.get(r.cls.slug) ?? null,
    });
  }
  return out;
}

/** Прокат по slug в городе (скрытые — нет). */
export async function getShopBySlug(cityId: string, slug: string): Promise<RentalShop | null> {
  const [row] = await getDb().select({ shop: rentalShops, ...shopPlaceCols }).from(rentalShops)
    .leftJoin(shopMd, eq(shopMd.id, rentalShops.microdistrictId))
    .leftJoin(shopOkrug, eq(shopOkrug.id, rentalShops.okrugId))
    .where(and(eq(rentalShops.cityId, cityId), eq(rentalShops.slug, slug), ne(rentalShops.status, "hidden")))
    .limit(1);
  return row ? withPlace(row) : null;
}

/** Группы с предложениями в городе — для sitemap. */
export async function getGroupsWithOffers(): Promise<{ citySlug: string; groupSlug: string }[]> {
  return getDb()
    .selectDistinct({ citySlug: cities.slug, groupSlug: itemGroups.slug })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .innerJoin(cities, eq(cities.id, rentalShops.cityId))
    .innerJoin(itemClasses, eq(itemClasses.id, offers.itemClassId))
    .innerJoin(itemGroups, eq(itemGroups.id, itemClasses.groupId))
    .where(and(
      eq(cities.isActive, true), ne(rentalShops.status, "hidden"),
      eq(offers.isActive, true), eq(itemGroups.isActive, true),
    ));
}

/** Бренды, модели справочника с числом прокатов и ценой «от» — для поиска. */
async function getSearchModels(cityId: string, freshSince: string): Promise<Pick<SearchData, "brands" | "models">> {
  const db = getDb();
  const brandRows = await db.select({ slug: brands.slug, name: brands.name, aliases: brands.aliases }).from(brands);
  const stats = db
    .select({
      modelId: offers.modelId,
      shops: sql<number>`count(distinct ${offers.shopId})::int`.as("shops"),
      fromDay: sql<number | null>`min(${offers.priceDay}) filter (where ${offers.verifiedAt} >= ${freshSince})`.as("from_day"),
    })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .where(visible(cityId))
    .groupBy(offers.modelId)
    .as("stats");
  const rows = await db
    .select({
      slug: productModels.slug, name: productModels.name, family: productModels.family, brand: brands.slug,
      classSlug: itemClasses.slug, groupSlug: itemGroups.slug,
      shops: stats.shops, fromDay: stats.fromDay,
      aliases: sql<string[]>`coalesce(array_agg(${modelAliases.alias}) filter (where ${modelAliases.alias} is not null), '{}')`,
    })
    .from(productModels)
    .innerJoin(brands, eq(brands.id, productModels.brandId))
    .innerJoin(itemClasses, eq(itemClasses.id, productModels.itemClassId))
    .innerJoin(itemGroups, eq(itemGroups.id, itemClasses.groupId))
    .leftJoin(stats, eq(stats.modelId, productModels.id))
    .leftJoin(modelAliases, eq(modelAliases.modelId, productModels.id))
    .where(and(eq(productModels.isActive, true), eq(itemGroups.isActive, true), eq(itemClasses.isActive, true)))
    .groupBy(productModels.id, brands.slug, itemClasses.slug, itemGroups.slug, stats.shops, stats.fromDay);
  return {
    brands: brandRows,
    models: rows.map((r) => ({ ...r, shops: r.shops ?? 0, fromDay: r.fromDay ?? null })),
  };
}

/** Данные поиска «Что нужно» для города: каталог с синонимами, бренды и модели. */
export async function getSearchData(cityId: string, freshSince: string, catalog?: NavCategory[]): Promise<SearchData & { seoWords: Record<string, string> }> {
  const [cat, bm] = await Promise.all([catalog ?? getCompareCatalog(cityId, freshSince), getSearchModels(cityId, freshSince)]);
  const groups = cat.flatMap((c) => c.groups.map((g) => ({
    slug: g.slug,
    name: g.name,
    nameGenitive: g.nameGenitive,
    category: c.name,
    keywords: g.keywords,
    shops: g.shops,
    fromPrice: g.fromPrice,
    classes: g.classes,
  })));
  return {
    groups,
    ...bm,
    seoWords: Object.fromEntries(cat.flatMap((c) => c.groups.map((g) => [g.slug, g.seoWord]))),
  };
}

/**
 * Запасной поиск по тому, как модель записана у проката (`ILIKE '%…%'`): находит
 * предложения с нераспознанными моделями, которых нет в справочнике.
 */
export async function findGroupsByRawModel(cityId: string, text: string): Promise<string[]> {
  const q = text.trim().replace(/[%_\\]/g, "");
  if (q.length < 3) return [];
  const rows = await getDb()
    .selectDistinct({ slug: itemGroups.slug })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .innerJoin(itemClasses, eq(itemClasses.id, offers.itemClassId))
    .innerJoin(itemGroups, eq(itemGroups.id, itemClasses.groupId))
    .where(and(visible(cityId), ilike(offers.model, `%${q}%`)));
  return rows.map((r) => r.slug);
}

/** Справочник мест города: округа и микрорайоны. */
export async function getCityGeo(cityId: string): Promise<CityGeo> {
  const rows = await getDb().select().from(districts).where(eq(districts.cityId, cityId)).orderBy(asc(districts.sort));
  const okrugSlug = new Map(rows.filter((r) => r.kind === "okrug").map((r) => [r.id, r.slug]));
  return {
    okrugs: rows.filter((r) => r.kind === "okrug")
      .map((r) => ({ slug: r.slug, name: r.name, aliases: r.aliases, lat: r.lat, lon: r.lon })),
    microdistricts: rows.filter((r) => r.kind === "microdistrict")
      .map((r) => ({ slug: r.slug, name: r.name, aliases: r.aliases, lat: r.lat, lon: r.lon, okrug: okrugSlug.get(r.parentId ?? "") ?? "" })),
  };
}

export interface ModelPage {
  model: { id: string; slug: string; name: string; family: string | null; brand: string };
  group: ItemGroup;
  cls: ItemClass;
  category: { slug: string; name: string };
}

/** Страница модели по сегменту /{city}/{prokat|arenda}-{slug}: слово — из seo_word группы. */
export async function getModelBySeg(seg: string): Promise<ModelPage | null> {
  const m = /^(prokat|arenda)-(.+)$/.exec(seg);
  if (!m) return null;
  const [row] = await getDb()
    .select({
      model: { id: productModels.id, slug: productModels.slug, name: productModels.name, family: productModels.family, brand: brands.name },
      group: itemGroups, cls: itemClasses, category: { slug: categories.slug, name: categories.name },
    })
    .from(productModels)
    .innerJoin(brands, eq(brands.id, productModels.brandId))
    .innerJoin(itemClasses, eq(itemClasses.id, productModels.itemClassId))
    .innerJoin(itemGroups, eq(itemGroups.id, itemClasses.groupId))
    .innerJoin(categories, eq(categories.id, itemGroups.categoryId))
    .where(and(eq(productModels.slug, m[2]), eq(productModels.isActive, true)))
    .limit(1);
  return row && row.group.seoWord === m[1] ? row : null;
}

/** Модели с предложениями в городе — для sitemap: /{city}/{seoWord}-{model}. */
export async function getModelsWithOffers(freshSince: string): Promise<{ citySlug: string; seoWord: string; modelSlug: string }[]> {
  return getDb()
    .selectDistinct({ citySlug: cities.slug, seoWord: itemGroups.seoWord, modelSlug: productModels.slug })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .innerJoin(cities, eq(cities.id, rentalShops.cityId))
    .innerJoin(productModels, eq(productModels.id, offers.modelId))
    .innerJoin(itemClasses, eq(itemClasses.id, productModels.itemClassId))
    .innerJoin(itemGroups, eq(itemGroups.id, itemClasses.groupId))
    // Только свежие цены: страница модели с одними ценами на перепроверке — пустая выдача.
    .where(and(
      eq(cities.isActive, true), ne(rentalShops.status, "hidden"), eq(offers.isActive, true),
      eq(productModels.isActive, true), gte(offers.verifiedAt, freshSince),
    ));
}
