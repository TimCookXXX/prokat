// Read-слой сравнения прокатов: группы и классы, предложения, прокаты.
// Телефоны прокатов наружу не отдаются — только через revealShopPhone (по клику).

import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  categories, cities, itemClasses, itemGroups, offers, rentalShops,
} from "@db/schema";
import type { CompareOffer } from "@/lib/compare/view";
import type { SearchGroupInput } from "@/lib/compare/search";

export type ItemGroup = typeof itemGroups.$inferSelect;
export type ItemClass = typeof itemClasses.$inferSelect;
export type RentalShop = typeof rentalShops.$inferSelect;

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

/** Предложения класса в городе — в форме, которую понимает pricing.ts. */
export async function getClassOffers(cityId: string, itemClassId: string): Promise<CompareOffer[]> {
  const rows = await getDb()
    .select({ offer: offers, shop: rentalShops })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .where(and(visible(cityId), eq(offers.itemClassId, itemClassId)));
  return rows.map(({ offer: o, shop: s }) => toCompareOffer(o, s));
}

export function toCompareOffer(o: typeof offers.$inferSelect, s: RentalShop): CompareOffer {
  return {
    id: o.id,
    shopId: s.id,
    shopSlug: s.slug,
    shopName: s.name,
    itemClassId: o.itemClassId,
    model: o.model,
    district: s.district ?? "",
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

export interface NavClass { slug: string; name: string; shortHint: string | null }
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
    g.classes.push({ slug: r.cls.slug, name: r.cls.name, shortHint: r.cls.shortHint });
  }
  return out;
}

/** Прокат по slug в городе (скрытые — нет). */
export async function getShopBySlug(cityId: string, slug: string): Promise<RentalShop | null> {
  const [shop] = await getDb().select().from(rentalShops)
    .where(and(eq(rentalShops.cityId, cityId), eq(rentalShops.slug, slug), ne(rentalShops.status, "hidden")))
    .limit(1);
  return shop ?? null;
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

export interface SearchModel {
  groupSlug: string;
  classSlug: string;
  model: string;
  shops: number;
  fromDay: number | null;
}

/** Модели с предложениями в городе — для подсказок поиска. Цена «от» — только по свежим ценам. */
export async function getSearchModels(cityId: string, freshSince: string): Promise<SearchModel[]> {
  const rows = await getDb()
    .select({
      groupSlug: itemGroups.slug,
      classSlug: itemClasses.slug,
      model: offers.model,
      shops: sql<number>`count(distinct ${offers.shopId})::int`,
      fromDay: sql<number | null>`min(${offers.priceDay}) filter (where ${offers.verifiedAt} >= ${freshSince})`,
    })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .innerJoin(itemClasses, eq(itemClasses.id, offers.itemClassId))
    .innerJoin(itemGroups, eq(itemGroups.id, itemClasses.groupId))
    .where(and(visible(cityId), isNotNull(offers.model), eq(itemGroups.isActive, true), eq(itemClasses.isActive, true)))
    .groupBy(itemGroups.slug, itemClasses.slug, offers.model)
    .orderBy(asc(offers.model));
  return rows.filter((r): r is SearchModel => !!r.model?.trim());
}

/** Данные поиска «Что нужно» для города: каталог с синонимами и модели. */
export function toSearchData(catalog: NavCategory[], models: SearchModel[]): { groups: SearchGroupInput[]; models: SearchModel[] } {
  return {
    groups: catalog.flatMap((c) => c.groups.map((g) => ({
      slug: g.slug,
      name: g.name,
      nameGenitive: g.nameGenitive,
      category: c.name,
      keywords: g.keywords,
      shops: g.shops,
      fromPrice: g.fromPrice,
      classes: g.classes,
    }))),
    models,
  };
}
