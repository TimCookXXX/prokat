// Read-слой личного кабинета покупателя.

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, bookingRequests, listings, users } from "@db/schema";
import type { AccountIdentity } from "@/components/account/identity";

export async function getUserProfile(userId: string) {
  const db = getDb();
  const [userRows, accountRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId)),
  ]);
  const user = userRows[0];
  if (!user) return null;
  return { user, providers: accountRows.map((a) => a.provider) };
}

// Форма ответа описана рядом с потребителями шапки кабинета.
export type { AccountIdentity as CabinetIdentity } from "@/components/account/identity";

/* Шапка кабинета: кто я и как у меня идут дела. Рейтинга и отзывов в модели
 * нет, поэтому считаем то, что есть на самом деле — сколько вещей выставлено
 * и сколько аренд доведено до конца, по обе стороны сделки. Два последних
 * счётчика подписывают строки мобильного хаба: «2 брони», «1 ждёт». */
export async function getCabinetIdentity(userId: string): Promise<AccountIdentity | null> {
  const db = getDb();
  const [userRows, listingRows, dealRows] = await Promise.all([
    db
      .select({
        name: users.name,
        // Почта видна только владельцу кабинета: подсказка, под каким аккаунтом
        // он сидит. Публично адрес нигде не показывается.
        email: users.email,
        image: users.image,
        coverUrl: users.coverUrl,
        isVerified: users.isVerified,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(eq(listings.ownerUserId, userId), eq(listings.status, "active"))),
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(bookingRequests)
      .where(and(
        or(
          eq(bookingRequests.ownerUserId, userId),
          eq(bookingRequests.customerUserId, userId),
        ),
        // Только доведённые до конца. Прежде сюда прибавлялась ещё и
        // «неявка» — то есть аренда, которой не было; вида больше нет.
        eq(bookingRequests.status, "completed"),
      )),
  ]);

  const user = userRows[0];
  if (!user) return null;

  return {
    ...user,
    activeListings: listingRows[0]?.cnt ?? 0,
    deals: dealRows[0]?.cnt ?? 0,
  };
}
