// Read-слой кабинета. Любой залогиненный юзер размещает товары и получает
// заявки на них; отдельной роли/сущности «владелец» нет.

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { bookingRequests, categories, cities, listings } from "@db/schema";
import { expireStaleRequests } from "@/server/actions/booking";

// Ленту заявок обеих ролей отдаёт getCabinetRequests в server/cabinet.ts.
// Здесь остался только счётчик: он про другое число — сколько ждёт МОЕГО
// ответа, — и его зовут три layout'а и профиль.
export async function countNewRequests(userId: string): Promise<number> {
  await expireStaleRequests();
  const rows = await getDb()
    .select({ cnt: sql<number>`count(*)::int` })
    .from(bookingRequests)
    .where(and(
      eq(bookingRequests.ownerUserId, userId),
      eq(bookingRequests.status, "new"),
    ));
  return rows[0]?.cnt ?? 0;
}

// Все товары юзера (включая скрытые/архив) для кабинета.
export async function getOwnerListings(userId: string) {
  return getDb().select().from(listings)
    .where(eq(listings.ownerUserId, userId))
    .orderBy(desc(listings.createdAt));
}

/* Одна вещь для её страницы в кабинете. Слаги города и категории — чтобы
 * собрать адрес витрины: со страницы вещи туда есть ссылка, а других данных
 * для listingPath() в строке объявления нет. Обе колонки notNull, поэтому
 * innerJoin строк не теряет. */
export async function getOwnerListing(userId: string, listingId: string) {
  const rows = await getDb()
    .select({
      listing: listings,
      citySlug: cities.slug,
      categorySlug: categories.slug,
    })
    .from(listings)
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .where(and(eq(listings.id, listingId), eq(listings.ownerUserId, userId)))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.listing, citySlug: row.citySlug, categorySlug: row.categorySlug } : null;
}
