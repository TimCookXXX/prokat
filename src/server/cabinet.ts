// Сводка кабинета: одна страница вместо обхода пяти разделов.

import { and, asc, desc, eq, gt, gte, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { availability, bookingRequests, categories, chatThreads, cities, events, listings, users } from "@db/schema";
import { expireStaleRequests } from "@/server/actions/booking";
import { todayStr, addDaysStr } from "@/lib/catalog/dates";
import type { BookingStatus } from "@/lib/catalog/booking-status";
import {
  disclosedPhone, requestSide, type RequestSide,
} from "@/lib/booking/request-access";
import type { LinkableListing } from "@/lib/booking/listing-link";

export interface CabinetDeal {
  id: string;
  listingTitle: string;
  /** Та же тройка полей, что и у строки ленты, и по той же причине: сводка
   *  показывает подтверждённые сделки, а вещь могли убрать посреди аренды. */
  listing: LinkableListing;
  dateFrom: string;
  dateTo: string;
  qty: number;
  expiresAt: Date;
  peerName: string | null;
}

/* Строка ленты заявок — одна на обе роли. Полей ownerPhone и customerPhone
 * здесь нет намеренно: наружу уходит только peerPhone, уже прошедший через
 * правило раскрытия. Показать не тот телефон из этой строки неоткуда. */
export interface CabinetRequestRow {
  id: string;
  /** Кто я в этой заявке. Единственный источник ролевых решений в интерфейсе. */
  side: RequestSide;
  status: BookingStatus;
  dateFrom: string;
  dateTo: string;
  qty: number;
  createdAt: Date;
  expiresAt: Date;
  ownerComment: string | null;
  customerComment: string | null;
  /** Всё, что нужно ссылке на вещь: публичный контур закрывают и статус, и бан
   *  владельца — см. lib/booking/listing-link. */
  listing: LinkableListing & { title: string; image: string | null; priceDay: number };
  /** Переписка пары (вещь, арендатор). Пусто у заявок, созданных до журнала
   *  сделки, по которым ещё не принималось решение. */
  threadId: string | null;
  peer: { id: string; name: string | null };
  /** Телефон второй стороны или null — см. lib/booking/request-access. */
  peerPhone: string | null;
}

export interface CabinetRequestsOptions {
  /** Сужает выдачу до одной стороны. Расширить ею права нельзя — см. ниже. */
  role?: RequestSide;
  listingId?: string;
  statuses?: readonly BookingStatus[];
  /** Без значения — без ограничения: пагинации в проекте нет, и молча
   *  обрезанная лента потеряла бы заявку без единого признака. */
  limit?: number;
}

/* Условие выборки — отдельной функцией, чтобы главное её свойство проверялось
 * тестом: права ставятся всегда, а role добавляется через AND и только сужает.
 * Подменять им базовый предикат нельзя — параметр приходит из адреса, и при
 * подмене он расширял бы выдачу вместо того, чтобы её сужать. */
export function cabinetRequestsWhere(userId: string, opts: CabinetRequestsOptions = {}) {
  const conds = [or(
    eq(bookingRequests.ownerUserId, userId),
    eq(bookingRequests.customerUserId, userId),
  )];
  if (opts.role === "owner") conds.push(eq(bookingRequests.ownerUserId, userId));
  if (opts.role === "customer") conds.push(eq(bookingRequests.customerUserId, userId));
  if (opts.listingId !== undefined) conds.push(eq(bookingRequests.listingId, opts.listingId));
  // Пустой список статусов — это «ни одного», а не «любой»: на этапе слияния
  // значения поедут из адреса, и «фильтр ничего не выбрал» обязан дать пустую
  // ленту, а не всю. inArray пустой массив не принимает, поэтому явное false.
  if (opts.statuses !== undefined) {
    conds.push(opts.statuses.length === 0
      ? sql`false`
      : inArray(bookingRequests.status, [...opts.statuses]));
  }
  return and(...conds);
}

/* Заявки, где я любая из сторон. Заменяет две прежние выборки — владельца и
 * арендатора, — которые расходились сортировкой, набором полей и правилом
 * раскрытия телефона.
 *
 * Один запрос, а не два со склейкой: лимит, применённый до склейки, обрезал бы
 * не то. Протухание — лениво, как и у прежних двух: крона в проекте нет. */
export async function getCabinetRequests(
  userId: string,
  opts: CabinetRequestsOptions = {},
): Promise<CabinetRequestRow[]> {
  await expireStaleRequests();

  const peer = alias(users, "peer");
  // Владелец вещи отдельным join'ом, а не через peer: peer им оказывается
  // только когда смотрит арендатор, а бан нужен знать в обоих случаях.
  const lister = alias(users, "lister");

  const query = getDb()
    .select({
      id: bookingRequests.id,
      status: bookingRequests.status,
      dateFrom: bookingRequests.dateFrom,
      dateTo: bookingRequests.dateTo,
      qty: bookingRequests.qty,
      createdAt: bookingRequests.createdAt,
      expiresAt: bookingRequests.expiresAt,
      ownerComment: bookingRequests.ownerComment,
      customerComment: bookingRequests.customerComment,
      ownerUserId: bookingRequests.ownerUserId,
      customerUserId: bookingRequests.customerUserId,
      customerPhone: bookingRequests.customerPhone,
      listingId: listings.id,
      listingTitle: listings.title,
      listingSlug: listings.slug,
      listingStatus: listings.status,
      // Обложка в SQL, как в getThreadList: весь photos_json ради миниатюры
      // не тянем.
      listingImage: sql<string | null>`${listings.photosJson}->0->>'url'`,
      listingPriceDay: listings.priceDay,
      listerBannedAt: lister.bannedAt,
      threadId: chatThreads.id,
      citySlug: cities.slug,
      categorySlug: categories.slug,
      peerId: peer.id,
      peerName: peer.name,
      peerPhone: peer.phone,
    })
    .from(bookingRequests)
    .innerJoin(listings, eq(listings.id, bookingRequests.listingId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .innerJoin(lister, eq(lister.id, listings.ownerUserId))
    // Тред пары (вещь, арендатор) — leftJoin: у заявок старше журнала сделки
    // его может не быть, и строка ленты обязана выжить без него.
    .leftJoin(chatThreads, and(
      eq(chatThreads.listingId, listings.id),
      eq(chatThreads.customerUserId, bookingRequests.customerUserId),
    ))
    // Вторая сторона одним join'ом: кто именно — решает та же колонка, что и
    // права, поэтому условие вычисляется, а не выбирается снаружи.
    .innerJoin(peer, sql`${peer.id} = case
      when ${bookingRequests.ownerUserId} = ${userId} then ${bookingRequests.customerUserId}
      else ${bookingRequests.ownerUserId} end`)
    .where(cabinetRequestsWhere(userId, opts))
    // Ровно прежний порядок обеих лент: у владельца новые наверх, у арендатора
    // таких строк нет и остаётся чистая свежесть. Расширять ключ нельзя —
    // «жду ответа» и «мне действовать» это разные вещи.
    .orderBy(
      sql`case when ${bookingRequests.ownerUserId} = ${userId}
        and ${bookingRequests.status} = 'new' then 0 else 1 end`,
      desc(bookingRequests.createdAt),
    );

  const rows = opts.limit !== undefined ? await query.limit(opts.limit) : await query;

  return rows.flatMap((r) => {
    const parties = { ownerUserId: r.ownerUserId, customerUserId: r.customerUserId };
    const side = requestSide(parties, userId);
    // Чужая строка сюда не доедет — условие выборки её отсекает. Пустой массив
    // вместо исключения: сторож не должен ронять страницу.
    if (!side) return [];
    const status = r.status as BookingStatus;
    return [{
      id: r.id,
      side,
      status,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      qty: r.qty,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      ownerComment: r.ownerComment,
      customerComment: r.customerComment,
      listing: {
        id: r.listingId,
        title: r.listingTitle,
        slug: r.listingSlug,
        citySlug: r.citySlug,
        categorySlug: r.categorySlug,
        status: r.listingStatus,
        ownerBannedAt: r.listerBannedAt,
        image: r.listingImage,
        priceDay: r.listingPriceDay,
      },
      threadId: r.threadId,
      peer: { id: r.peerId, name: r.peerName },
      // peer.phone — профиль второй стороны, и владельцем она оказывается
      // только когда смотрит арендатор. Подставлять её как ownerPhone в другом
      // случае нельзя: сейчас правило туда не заглядывает, но подпись «телефон
      // владельца» под телефоном клиента — заготовленная утечка.
      peerPhone: disclosedPhone({
        ...parties,
        status,
        customerPhone: r.customerPhone,
        ownerPhone: side === "customer" ? r.peerPhone : null,
      }, userId),
    }];
  });
}

export interface CabinetSummary {
  /** Заявки, которые ждут решения владельца: у каждой горит свой срок. */
  pending: CabinetDeal[];
  /** Сколько их всего — карточек в pending не больше пяти. */
  pendingTotal: number;
  /** Подтверждённые аренды: моя вещь уехала к арендатору. */
  lending: CabinetDeal[];
  /** Подтверждённые аренды, где арендатор — я. */
  borrowing: CabinetDeal[];
  stats: {
    views7d: number;
    requests30d: number;
    activeListings: number;
    busyDays30d: number;
  };
}

export async function getCabinetSummary(userId: string): Promise<CabinetSummary> {
  // Читаем после протухания: заявка с истёкшим сроком не должна висеть
  // в «требует действия».
  await expireStaleRequests();

  const db = getDb();
  const today = todayStr();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const myListings = db
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.ownerUserId, userId));

  const [pending, pendingTotal, lending, borrowing, views, requests, active, busy] = await Promise.all([
    deals(userId, "owner", "new"),

    // Сколько их всего: карточек показываем пять, и без числа шестая заявка
    // была бы не видна и ничем не обозначена.
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(bookingRequests)
      .where(and(
        eq(bookingRequests.ownerUserId, userId),
        eq(bookingRequests.status, "new"),
      )),

    deals(userId, "owner", "confirmed"),
    deals(userId, "customer", "confirmed"),

    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(events)
      .where(and(
        eq(events.event, "view_listing"),
        gte(events.createdAt, weekAgo),
        inArray(events.entityId, myListings),
      )),

    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(bookingRequests)
      .where(and(
        eq(bookingRequests.ownerUserId, userId),
        gte(bookingRequests.createdAt, monthAgo),
      )),

    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(eq(listings.ownerUserId, userId), eq(listings.status, "active"))),

    // Занятость на месяц вперёд: сколько дней хотя бы одна вещь в работе.
    db
      .select({ cnt: sql<number>`count(distinct ${availability.date})::int` })
      .from(availability)
      .where(and(
        inArray(availability.listingId, myListings),
        gte(availability.date, today),
        lte(availability.date, addDaysStr(today, 30)),
        gt(availability.bookedQty, 0),
      )),
  ]);

  return {
    pending,
    pendingTotal: pendingTotal[0]?.cnt ?? 0,
    lending,
    borrowing,
    stats: {
      views7d: views[0]?.cnt ?? 0,
      requests30d: requests[0]?.cnt ?? 0,
      activeListings: active[0]?.cnt ?? 0,
      busyDays30d: busy[0]?.cnt ?? 0,
    },
  };
}

/* Заявки одной стороны сделки вместе с вещью и вторым участником: карточка
 * сводки отвечает «что, когда и с кем» без дополнительных запросов.
 *
 * Ожидающие решения сортируются по сроку — первым то, что сгорит раньше;
 * подтверждённые — по дате начала. */
async function deals(
  userId: string,
  side: "owner" | "customer",
  status: "new" | "confirmed",
): Promise<CabinetDeal[]> {
  const peer = alias(users, "peer");
  const lister = alias(users, "lister");
  const mineColumn = side === "owner" ? bookingRequests.ownerUserId : bookingRequests.customerUserId;
  const peerColumn = side === "owner" ? bookingRequests.customerUserId : bookingRequests.ownerUserId;

  const rows = await getDb()
    .select({
      id: bookingRequests.id,
      listingId: bookingRequests.listingId,
      listingTitle: listings.title,
      listingSlug: listings.slug,
      listingStatus: listings.status,
      listerBannedAt: lister.bannedAt,
      citySlug: cities.slug,
      categorySlug: categories.slug,
      dateFrom: bookingRequests.dateFrom,
      dateTo: bookingRequests.dateTo,
      qty: bookingRequests.qty,
      expiresAt: bookingRequests.expiresAt,
      peerName: peer.name,
    })
    .from(bookingRequests)
    .innerJoin(listings, eq(listings.id, bookingRequests.listingId))
    .innerJoin(cities, eq(cities.id, listings.cityId))
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .innerJoin(lister, eq(lister.id, listings.ownerUserId))
    .innerJoin(peer, eq(peer.id, peerColumn))
    .where(and(eq(mineColumn, userId), eq(bookingRequests.status, status)))
    .orderBy(status === "new" ? asc(bookingRequests.expiresAt) : asc(bookingRequests.dateFrom))
    .limit(5);

  return rows.map((r) => ({
    id: r.id,
    listingTitle: r.listingTitle,
    listing: {
      id: r.listingId,
      slug: r.listingSlug,
      citySlug: r.citySlug,
      categorySlug: r.categorySlug,
      status: r.listingStatus,
      ownerBannedAt: r.listerBannedAt,
    },
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    qty: r.qty,
    expiresAt: r.expiresAt,
    peerName: r.peerName,
  }));
}
