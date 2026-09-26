"use server";

// Server actions флоу заявок: создание (покупатель) и отмена (покупатель).
// Подтверждение/отклонение владельцем — в кабинете владельца (следующий этап).
//
// Инварианты:
// - только confirmed-заявка держит bookedQty (см. lib/catalog/booking-status);
//   создание new-заявки availability НЕ трогает;
// - отмена confirmed освобождает даты в той же транзакции, что и смена статуса;
// - протухание new-заявок ленивое: expireStaleRequests() дёргается перед
//   чтением списков, крона в v1 нет.

import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  availability, bookingRequests, events, listings, users,
} from "@db/schema";
import { auth } from "@/lib/auth";
import { newId } from "@/lib/id";
import { checkLimit } from "@/lib/rate-limit";
import { bookingFormSchema } from "@/lib/booking/validation";
import { parseBookingParams } from "@/lib/booking/params";
import { unavailableDates, type AvailabilityMap } from "@/lib/catalog/availability";
import { canTransition, availabilityDelta } from "@/lib/catalog/booking-status";
import { todayStr } from "@/lib/catalog/dates";
import { isP2PEnabled, P2P_DISABLED } from "@/lib/features";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const EXPIRES_HOURS = 24;

export async function createBookingRequest(
  input: unknown,
): Promise<ActionResult<{ requestId: string }>> {
  if (!isP2PEnabled()) return { ok: false, error: P2P_DISABLED };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };
  if (session.user.bannedAt) return { ok: false, error: "banned" };

  const parsed = bookingFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  }
  const form = parsed.data;

  // Honeypot: боту отвечаем «успехом», заявку не создаём.
  if (form.website !== "") return { ok: true, data: { requestId: "" } };

  const limit = checkLimit(session.user.id, "booking");
  if (!limit.ok) return { ok: false, error: `rate_limited:${limit.retryAfterSec}` };

  const db = getDb();
  const listingRows = await db.select().from(listings)
    .where(and(eq(listings.id, form.listingId), eq(listings.status, "active")))
    .limit(1);
  const listing = listingRows[0];
  if (!listing) return { ok: false, error: "listing_not_found" };

  // Кламп дат к [today, horizon] — форма могла пролежать открытой.
  const sel = parseBookingParams(
    { from: form.from, to: form.to, qty: String(form.qty) },
    { today: todayStr(), maxQty: listing.quantity },
  );

  const availRows = await db.select().from(availability).where(and(
    eq(availability.listingId, listing.id),
    gte(availability.date, sel.from),
    lte(availability.date, sel.to),
  ));
  const map: AvailabilityMap = new Map(
    availRows.map((r) => [r.date, { bookedQty: r.bookedQty, blockedQty: r.blockedQty }]),
  );
  const busy = unavailableDates(listing.quantity, map, sel.from, sel.to, sel.qty);
  if (busy.length > 0) return { ok: false, error: `dates_taken:${busy.join(",")}` };

  const requestId = newId();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(bookingRequests).values({
      id: requestId,
      listingId: listing.id,
      ownerUserId: listing.ownerUserId,
      customerUserId: session.user.id,
      dateFrom: sel.from,
      dateTo: sel.to,
      qty: sel.qty,
      status: "new",
      customerPhone: form.phone,
      customerComment: form.comment || null,
      expiresAt: new Date(now.getTime() + EXPIRES_HOURS * 60 * 60 * 1000),
    });
    // Телефон из первой заявки запоминаем в профиле для предзаполнения.
    await tx.update(users)
      .set({ phone: form.phone })
      .where(and(eq(users.id, session.user.id), sql`${users.phone} IS NULL`));
    await tx.insert(events).values({
      id: newId(),
      entityType: "listing",
      entityId: listing.id,
      event: "submit_request",
      userId: session.user.id,
      metaJson: { requestId, from: sel.from, to: sel.to, qty: sel.qty },
    });
  });

  revalidatePath("/requests");
  return { ok: true, data: { requestId } };
}

export async function cancelBookingRequest(requestId: string): Promise<ActionResult> {
  if (!isP2PEnabled()) return { ok: false, error: P2P_DISABLED };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(bookingRequests)
        .where(eq(bookingRequests.id, requestId))
        .for("update")
        .limit(1);
      const req = rows[0];
      if (!req || req.customerUserId !== session.user.id) throw new Error("not_found");
      if (!canTransition(req.status, "cancelled")) throw new Error("bad_status");

      // Отмена confirmed освобождает даты; new ничего не держит.
      if (availabilityDelta(req.status, "cancelled") === -1) {
        await tx.update(availability)
          .set({ bookedQty: sql`greatest(0, ${availability.bookedQty} - ${req.qty})` })
          .where(and(
            eq(availability.listingId, req.listingId),
            gte(availability.date, req.dateFrom),
            lte(availability.date, req.dateTo),
          ));
      }

      await tx.update(bookingRequests)
        .set({ status: "cancelled", respondedAt: new Date() })
        .where(eq(bookingRequests.id, requestId));

      await tx.insert(events).values({
        id: newId(),
        entityType: "booking_request",
        entityId: requestId,
        event: "cancel_request",
        userId: session.user.id,
        metaJson: { fromStatus: req.status },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "not_found" || msg === "bad_status") return { ok: false, error: msg };
    throw e;
  }

  revalidatePath("/requests");
  return { ok: true, data: undefined };
}

// Ленивое протухание: new-заявки с истёкшим expires_at помечаются expired.
// Дешёвый UPDATE по индексу (owner_status_idx покрывает status).
export async function expireStaleRequests(): Promise<void> {
  await getDb().update(bookingRequests)
    .set({ status: "expired", respondedAt: new Date() })
    .where(and(
      eq(bookingRequests.status, "new"),
      lt(bookingRequests.expiresAt, new Date()),
    ));
}

