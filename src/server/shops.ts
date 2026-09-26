// Read-слой прокатов: страница проката, список прокатов города, кабинет
// владельца, админка карточек. Телефон проката наружу не отдаётся — только
// через revealShopPhone.

import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  cities, itemClasses, itemGroups, leadEvents, offers, regularRequests, rentalShops, shopClaims, users,
} from "@db/schema";
import type { CompareOffer } from "@/lib/compare/view";
import { toCompareOffer, type RentalShop } from "@/server/compare";

export interface ShopOfferRow {
  offer: CompareOffer;
  isActive: boolean;
  cls: { id: string; slug: string; name: string };
  group: { slug: string; name: string };
}

/** Предложения проката (все, включая выключенные — для кабинета) с классом и группой. */
export async function getShopOffers(shop: RentalShop, { activeOnly = true } = {}): Promise<ShopOfferRow[]> {
  const rows = await getDb()
    .select({ offer: offers, cls: { id: itemClasses.id, slug: itemClasses.slug, name: itemClasses.name }, group: { slug: itemGroups.slug, name: itemGroups.name, sort: itemGroups.sort }, clsSort: itemClasses.sort })
    .from(offers)
    .innerJoin(itemClasses, eq(itemClasses.id, offers.itemClassId))
    .innerJoin(itemGroups, eq(itemGroups.id, itemClasses.groupId))
    .where(activeOnly ? and(eq(offers.shopId, shop.id), eq(offers.isActive, true)) : eq(offers.shopId, shop.id))
    .orderBy(asc(itemGroups.sort), asc(itemClasses.sort), asc(offers.model));
  return rows.map((r) => ({
    offer: toCompareOffer(r.offer, shop),
    isActive: r.offer.isActive,
    cls: r.cls,
    group: { slug: r.group.slug, name: r.group.name },
  }));
}

/** Все видимые предложения города по классам — для места в сравнении. */
export async function getCityOffersByClass(cityId: string, classIds: string[]): Promise<Map<string, CompareOffer[]>> {
  const out = new Map<string, CompareOffer[]>();
  if (classIds.length === 0) return out;
  const rows = await getDb()
    .select({ offer: offers, shop: rentalShops })
    .from(offers)
    .innerJoin(rentalShops, eq(rentalShops.id, offers.shopId))
    .where(and(
      eq(rentalShops.cityId, cityId), ne(rentalShops.status, "hidden"),
      eq(offers.isActive, true), inArray(offers.itemClassId, classIds),
    ));
  for (const { offer, shop } of rows) {
    const list = out.get(offer.itemClassId) ?? [];
    list.push(toCompareOffer(offer, shop));
    out.set(offer.itemClassId, list);
  }
  return out;
}

export interface CityShopRow {
  slug: string;
  name: string;
  district: string | null;
  claimed: boolean;
  offers: number;
}

export async function getCityShops(cityId: string): Promise<CityShopRow[]> {
  const rows = await getDb()
    .select({
      slug: rentalShops.slug,
      name: rentalShops.name,
      district: rentalShops.district,
      status: rentalShops.status,
      offers: sql<number>`count(${offers.id}) filter (where ${offers.isActive})::int`,
    })
    .from(rentalShops)
    .leftJoin(offers, eq(offers.shopId, rentalShops.id))
    .where(and(eq(rentalShops.cityId, cityId), ne(rentalShops.status, "hidden")))
    .groupBy(rentalShops.id)
    .orderBy(asc(rentalShops.name));
  return rows.map((r) => ({ slug: r.slug, name: r.name, district: r.district, claimed: r.status === "claimed", offers: r.offers }));
}

export async function getShopById(id: string): Promise<(RentalShop & { citySlug: string }) | null> {
  const [row] = await getDb()
    .select({ shop: rentalShops, citySlug: cities.slug })
    .from(rentalShops)
    .innerJoin(cities, eq(cities.id, rentalShops.cityId))
    .where(eq(rentalShops.id, id))
    .limit(1);
  return row ? { ...row.shop, citySlug: row.citySlug } : null;
}

/** Подтверждённые прокаты юзера (кабинет проката). */
export async function getOwnedShops(userId: string): Promise<(RentalShop & { citySlug: string })[]> {
  const rows = await getDb()
    .select({ shop: rentalShops, citySlug: cities.slug })
    .from(rentalShops)
    .innerJoin(cities, eq(cities.id, rentalShops.cityId))
    .where(and(eq(rentalShops.ownerUserId, userId), eq(rentalShops.status, "claimed")))
    .orderBy(asc(rentalShops.name));
  return rows.map((r) => ({ ...r.shop, citySlug: r.citySlug }));
}

export async function userOwnsShop(userId: string): Promise<boolean> {
  const [row] = await getDb().select({ id: rentalShops.id }).from(rentalShops)
    .where(and(eq(rentalShops.ownerUserId, userId), eq(rentalShops.status, "claimed"))).limit(1);
  return !!row;
}

export type LeadCounts = Partial<Record<(typeof leadEvents.$inferSelect)["type"], number>>;

/** Обращения к прокату за [from, to) — отчёт в кабинете. */
export async function getShopLeadCounts(shopId: string, from: Date, to: Date): Promise<LeadCounts> {
  const rows = await getDb()
    .select({ type: leadEvents.type, n: sql<number>`count(*)::int` })
    .from(leadEvents)
    .where(and(eq(leadEvents.shopId, shopId), gte(leadEvents.createdAt, from), lt(leadEvents.createdAt, to)))
    .groupBy(leadEvents.type);
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
}

export type ShopClaim = typeof shopClaims.$inferSelect;

/** Заявки юзера на карточки, новые сверху; name — прокат из базы или название из заявки. */
export async function getUserClaims(userId: string): Promise<(ShopClaim & { name: string })[]> {
  const rows = await getDb()
    .select({ claim: shopClaims, shopName: rentalShops.name })
    .from(shopClaims)
    .leftJoin(rentalShops, eq(rentalShops.id, shopClaims.shopId))
    .where(eq(shopClaims.userId, userId))
    .orderBy(desc(shopClaims.createdAt));
  return rows.map((r) => ({ ...r.claim, name: r.shopName ?? r.claim.shopName ?? "Прокат" }));
}

/** Прокаты города, которые ещё можно подтвердить — для формы заявки. */
export async function getClaimableShops(cityId: string): Promise<{ id: string; name: string; district: string | null }[]> {
  return getDb()
    .select({ id: rentalShops.id, name: rentalShops.name, district: rentalShops.district })
    .from(rentalShops)
    .where(and(eq(rentalShops.cityId, cityId), eq(rentalShops.status, "unclaimed")))
    .orderBy(asc(rentalShops.name));
}

// ------------------------------------------------------------------ админка

export interface AdminClaimRow {
  claim: ShopClaim;
  shop: { id: string; name: string; phone: string | null; slug: string; status: string } | null;
  user: { email: string; username: string | null };
  citySlug: string;
}

export async function adminListClaims(): Promise<AdminClaimRow[]> {
  const rows = await getDb()
    .select({
      claim: shopClaims,
      shop: { id: rentalShops.id, name: rentalShops.name, phone: rentalShops.phone, slug: rentalShops.slug, status: rentalShops.status },
      user: { email: users.email, username: users.username },
      citySlug: cities.slug,
    })
    .from(shopClaims)
    .leftJoin(rentalShops, eq(rentalShops.id, shopClaims.shopId))
    .innerJoin(users, eq(users.id, shopClaims.userId))
    .innerJoin(cities, eq(cities.id, shopClaims.cityId))
    .orderBy(sql`${shopClaims.status} = 'new' desc`, desc(shopClaims.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, shop: r.shop?.id ? r.shop : null }));
}

export async function adminListShops() {
  return getDb()
    .select({
      id: rentalShops.id,
      name: rentalShops.name,
      slug: rentalShops.slug,
      district: rentalShops.district,
      phone: rentalShops.phone,
      status: rentalShops.status,
      citySlug: cities.slug,
      offers: sql<number>`count(${offers.id})::int`,
      lastVerified: sql<string | null>`max(${offers.verifiedAt})`,
    })
    .from(rentalShops)
    .innerJoin(cities, eq(cities.id, rentalShops.cityId))
    .leftJoin(offers, eq(offers.shopId, rentalShops.id))
    .groupBy(rentalShops.id, cities.slug)
    .orderBy(asc(rentalShops.name));
}

export async function adminListRegularRequests() {
  return getDb()
    .select({ req: regularRequests, citySlug: cities.slug })
    .from(regularRequests)
    .innerJoin(cities, eq(cities.id, regularRequests.cityId))
    .orderBy(sql`${regularRequests.status} = 'new' desc`, desc(regularRequests.createdAt))
    .limit(300);
}

/** Сводка обращений с даты: по типам и по классам (для проверки гипотез). */
export async function adminLeadSummary(since: Date) {
  const db = getDb();
  const [byType, byClass] = await Promise.all([
    db.select({ type: leadEvents.type, n: sql<number>`count(*)::int`, sessions: sql<number>`count(distinct ${leadEvents.sessionId})::int` })
      .from(leadEvents).where(gte(leadEvents.createdAt, since)).groupBy(leadEvents.type),
    db.select({ cls: itemClasses.name, n: sql<number>`count(*)::int` })
      .from(leadEvents)
      .innerJoin(itemClasses, eq(itemClasses.id, leadEvents.itemClassId))
      .where(and(gte(leadEvents.createdAt, since), eq(leadEvents.type, "show_phone")))
      .groupBy(itemClasses.name)
      .orderBy(desc(sql`count(*)`)),
  ]);
  return { byType, byClass };
}
