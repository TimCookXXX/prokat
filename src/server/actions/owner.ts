"use server";

// Server actions кабинета: товары, решения по заявкам, ручное закрытие дат.
// «Владелец» — любой залогиненный юзер с товарами; отдельной сущности нет.
//
// Инварианты (см. lib/catalog/booking-status):
// - подтверждение заявки увеличивает bookedQty на диапазон в ТОЙ ЖЕ транзакции,
//   что и смена статуса; перед этим занятость перепроверяется под блокировкой;
// - completed/no_show дат не освобождают; отмена confirmed — освобождает
//   (реализована в cancelBookingRequest, здесь не дублируется);
// - blocked_qty — ручные закрытия владельцем, не пересекается с booked_qty.

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  availability, bookingRequests, events, listings, users,
} from "@db/schema";
import { auth } from "@/lib/auth";
import { newId } from "@/lib/id";
import { slugify } from "@/lib/slugify";
import { listingFormSchema } from "@/lib/owner/validation";
import { parseSellerName } from "@/lib/owner/seller-name";
import {
  unavailableDates, eachDate, type AvailabilityMap,
} from "@/lib/catalog/availability";
import { canTransition, type BookingStatus } from "@/lib/catalog/booking-status";
import { kindForDecision, type OwnerDecision } from "@/lib/notifications/kinds";
import { notify } from "@/server/notifications";
import { publish } from "@/server/realtime";
import { requestNotify } from "@/lib/realtime/events";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function requireUser(): Promise<{ userId: string } | null> {
  const session = await auth();
  if (!session?.user?.id || session.user.bannedAt) return null;
  return { userId: session.user.id };
}

// ============================== Товары ==============================

export async function createListing(input: unknown): Promise<ActionResult<{ listingId: string }>> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };

  const parsed = listingFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const form = parsed.data;

  // Имя продавца приезжает тем же вызовом отдельным ключом: listingFormSchema
  // не strict, лишний ключ она отбрасывает, поэтому достаём его из сырого ввода.
  const sellerName = parseSellerName(input);
  if (!sellerName.ok) return { ok: false, error: sellerName.error };

  const slug = slugify(form.title);
  if (!slug) return { ok: false, error: "Название должно содержать буквы или цифры" };

  // Пустое поле не затирает имя: значит человек его просто не трогал.
  if (sellerName.name) {
    await getDb().update(users).set({ name: sellerName.name }).where(eq(users.id, owner.userId));
  }

  const id = newId();
  // Без премодерации: товар сразу active. Уникальность URL даёт id в хвосте пути.
  await getDb().insert(listings).values({
    id,
    ownerUserId: owner.userId,
    cityId: form.cityId,
    categoryId: form.categoryId,
    title: form.title,
    slug,
    description: form.description || null,
    location: form.location || null,
    priceDay: form.priceDay,
    depositAmount: form.depositType === "money" ? form.depositAmount : null,
    depositType: form.depositType,
    quantity: form.quantity,
    handoverPickup: form.handoverPickup,
    handoverDelivery: form.handoverDelivery,
    photosJson: form.photos,
    status: "active",
  });

  revalidatePath("/cabinet/listings");
  return { ok: true, data: { listingId: id } };
}

export async function updateListing(listingId: string, input: unknown): Promise<ActionResult> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };

  const parsed = listingFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  const form = parsed.data;

  const res = await getDb().update(listings)
    .set({
      cityId: form.cityId,
      categoryId: form.categoryId,
      title: form.title, // слаг сохраняем: URL позиции не должен ломаться
      description: form.description || null,
      location: form.location || null,
      priceDay: form.priceDay,
      depositAmount: form.depositType === "money" ? form.depositAmount : null,
      depositType: form.depositType,
      quantity: form.quantity,
      handoverPickup: form.handoverPickup,
      handoverDelivery: form.handoverDelivery,
      photosJson: form.photos,
      updatedAt: new Date(),
    })
    .where(and(eq(listings.id, listingId), eq(listings.ownerUserId, owner.userId)))
    .returning({ id: listings.id });
  if (res.length === 0) return { ok: false, error: "not_found" };

  revalidatePath("/cabinet/listings");
  revalidatePath(`/cabinet/listings/${listingId}`);
  return { ok: true, data: undefined };
}

// Статус приходит извне и типу не соответствует автоматически: экшен доступен
// по сети напрямую, а произвольная строка доехала бы до enum-колонки и дала 500
// вместо внятного отказа.
const setStatusSchema = z.object({
  listingId: z.string().min(1),
  status: z.enum(["active", "hidden", "archived"]),
});

export async function setListingStatus(
  listingId: string,
  status: "active" | "hidden" | "archived",
): Promise<ActionResult> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };

  const parsed = setStatusSchema.safeParse({ listingId, status });
  if (!parsed.success) return { ok: false, error: "bad_status" };

  // hiddenByBan снимается вместе с явной сменой статуса, чтобы метка означала
  // ровно одно: строку погасил бан и с тех пор статуса никто не касался. Сюда
  // забаненный не дойдёт (requireUser его отсекает), но инвариант должен
  // держаться на любом пути записи, а не на рассуждении о достижимости.
  const res = await getDb().update(listings)
    .set({ status: parsed.data.status, hiddenByBan: false, updatedAt: new Date() })
    .where(and(eq(listings.id, parsed.data.listingId), eq(listings.ownerUserId, owner.userId)))
    .returning({ id: listings.id });
  if (res.length === 0) return { ok: false, error: "not_found" };

  revalidatePath("/cabinet/listings");
  return { ok: true, data: undefined };
}

// ============================== Заявки ==============================

// to сужен до решений владельца: BookingStatus знает семь значений, а вид
// уведомления есть только у четырёх, и `request_${to}` на полном union не
// типизируется. Все вызывающие и так передают одно из этих четырёх.
async function transitionRequest(
  requestId: string,
  to: OwnerDecision,
  ownerComment?: string,
): Promise<ActionResult> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };
  const userId = owner.userId;

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(bookingRequests)
        .where(eq(bookingRequests.id, requestId))
        .for("update")
        .limit(1);
      const req = rows[0];
      if (!req || req.ownerUserId !== userId) throw new Error("not_found");
      if (!canTransition(req.status, to)) throw new Error("bad_status");

      if (to === "confirmed") {
        // Лочим листинг (source of truth по quantity) и перепроверяем занятость.
        const lrows = await tx.select().from(listings)
          .where(eq(listings.id, req.listingId)).for("update").limit(1);
        const listing = lrows[0];
        if (!listing) throw new Error("not_found");

        const availRows = await tx.select().from(availability)
          .where(and(
            eq(availability.listingId, req.listingId),
            gte(availability.date, req.dateFrom),
            lte(availability.date, req.dateTo),
          ))
          .for("update");
        const map: AvailabilityMap = new Map(
          availRows.map((r) => [r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty }]),
        );
        const busy = unavailableDates(listing.quantity, map, req.dateFrom, req.dateTo, req.qty);
        if (busy.length > 0) throw new Error(`dates_taken:${busy.join(",")}`);

        for (const date of eachDate(req.dateFrom, req.dateTo)) {
          await tx.insert(availability)
            .values({ listingId: req.listingId, date, bookedQty: req.qty })
            .onConflictDoUpdate({
              target: [availability.listingId, availability.date],
              set: { bookedQty: sql`${availability.bookedQty} + ${req.qty}` },
            });
        }
      }

      await tx.update(bookingRequests)
        .set({
          status: to,
          respondedAt: new Date(),
          ...(ownerComment !== undefined ? { ownerComment: ownerComment || null } : {}),
        })
        .where(eq(bookingRequests.id, requestId));

      await tx.insert(events).values({
        id: newId(),
        entityType: "booking_request",
        entityId: requestId,
        event: `request_${to}`,
        userId,
        metaJson: { fromStatus: req.status },
      });
      // Решение принимает владелец — узнать о нём должен арендатор.
      const notified = await notify(tx, {
        recipientId: req.customerUserId,
        actorId: userId,
        kind: kindForDecision(to),
        side: "customer",
        entityId: requestId,
      });
      if (notified) {
        await publish(tx, requestNotify({
          kind: kindForDecision(to), requestId, recipientId: req.customerUserId,
        }));
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "not_found" || msg === "bad_status" || msg.startsWith("dates_taken:")) {
      return { ok: false, error: msg };
    }
    throw e;
  }

  // Лента одна на обе роли, поэтому адрес тоже один. Сводка — отдельно:
  // решение принимают и там, и карточка «требует действия» обязана уйти.
  revalidatePath("/cabinet/requests");
  revalidatePath("/cabinet");
  return { ok: true, data: undefined };
}

export async function confirmRequest(requestId: string, comment?: string): Promise<ActionResult> {
  return transitionRequest(requestId, "confirmed", comment);
}
export async function declineRequest(requestId: string, comment?: string): Promise<ActionResult> {
  return transitionRequest(requestId, "declined", comment);
}
export async function completeRequest(requestId: string): Promise<ActionResult> {
  return transitionRequest(requestId, "completed");
}
export async function noShowRequest(requestId: string): Promise<ActionResult> {
  return transitionRequest(requestId, "no_show");
}

// ============================== Календарь ==============================

// Ручное закрытие дат («сдал по телефону», «в ремонте»): выставляет blocked_qty
// на диапазон. qty=0 открывает даты обратно. Клампится к quantity позиции.
export async function setBlockedDates(
  listingId: string,
  dateFrom: string,
  dateTo: string,
  blockedQty: number,
): Promise<ActionResult> {
  const owner = await requireUser();
  if (!owner) return { ok: false, error: "auth_required" };

  if (!Number.isInteger(blockedQty) || blockedQty < 0) return { ok: false, error: "bad_qty" };

  const db = getDb();
  const lrows = await db.select().from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.ownerUserId, owner.userId)))
    .limit(1);
  const listing = lrows[0];
  if (!listing) return { ok: false, error: "not_found" };

  let dates: string[];
  try { dates = eachDate(dateFrom, dateTo); } catch { return { ok: false, error: "bad_dates" }; }
  if (dates.length > 366) return { ok: false, error: "range_too_long" };

  const qty = Math.min(blockedQty, listing.quantity);
  await db.transaction(async (tx) => {
    for (const date of dates) {
      await tx.insert(availability)
        .values({ listingId, date, blockedQty: qty })
        .onConflictDoUpdate({
          target: [availability.listingId, availability.date],
          set: { blockedQty: qty },
        });
    }
  });

  revalidatePath(`/cabinet/listings/${listingId}`);
  return { ok: true, data: undefined };
}
