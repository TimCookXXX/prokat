// Кто я в заявке и что мне из неё видно. Правила чистые и живут отдельно от
// запроса намеренно: живого Postgres тесты не требуют, а проверять права через
// мок билдера drizzle бессмысленно — тот же приём, что в lib/chat/rules.ts.
//
// Единственное место, где решается раскрытие телефона. Выборка кабинета отдаёт
// наружу только результат этих функций: в строке ленты нет полей ownerPhone и
// customerPhone, поэтому показать не тот телефон неоткуда.

import type { BookingStatus } from "@/lib/catalog/booking-status";

export type RequestSide = "owner" | "customer";

/** Обе стороны заявки. Совпасть они не могут: заявка на своё же объявление
 *  закрыта в createBookingRequest. */
export interface RequestParties {
  ownerUserId: string;
  customerUserId: string;
}

/** null означает «заявка не моя» — в ленте таких строк быть не должно, и это
 *  сторож на случай, если условие выборки когда-нибудь ослабят. */
export function requestSide(parties: RequestParties, viewerId: string): RequestSide | null {
  if (parties.ownerUserId === viewerId) return "owner";
  if (parties.customerUserId === viewerId) return "customer";
  return null;
}

export interface RequestPhones extends RequestParties {
  status: BookingStatus;
  /** Телефон клиента денормализован в саму заявку — он обязателен в форме. */
  customerPhone: string;
  /** Телефон владельца живёт в профиле и может быть не заполнен. */
  ownerPhone: string | null;
}

/* Телефон второй стороны или null, если раскрывать его ещё нельзя.
 *
 * Асимметрия намеренная. Владелец видит телефон клиента сразу: решение по
 * заявке принимается созвоном, и без телефона решать нечем. Арендатор видит
 * телефон владельца только после подтверждения — до него сделки ещё нет, и
 * рассылка заявок веером не должна собирать чужие контакты. */
export function disclosedPhone(request: RequestPhones, viewerId: string): string | null {
  const side = requestSide(request, viewerId);
  if (side === "owner") return request.customerPhone;
  if (side === "customer" && request.status === "confirmed") return request.ownerPhone;
  return null;
}
