// Статусная машина заявки на бронь. Единственный источник правды о том,
// какие переходы допустимы и как статус влияет на bookedQty в availability.
//
//   new ──confirm──▶ confirmed ──▶ completed (даты прошли — авто; или вернули
//    │                   │                    раньше срока — владелец)
//    ├─▶ declined        └─▶ cancelled (освобождает даты)
//    ├─▶ expired (авто, по expires_at)
//    └─▶ cancelled
//
// «Неявки» здесь нет: итог аренды определяет календарь, а не оценка владельцем
// того, как повёл себя клиент, — см. ADR 0018.

export type BookingStatus =
  | "new" | "confirmed" | "declined" | "expired"
  | "completed" | "cancelled";

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  new: ["confirmed", "declined", "expired", "cancelled"],
  confirmed: ["completed", "cancelled"],
  declined: [],
  expired: [],
  completed: [],
  cancelled: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

// Только confirmed-заявка держит единицы в availability.
export function holdsAvailability(status: BookingStatus): boolean {
  return status === "confirmed";
}

/* Знак изменения bookedQty при переходе: +1 — занять даты, -1 — освободить,
 * 0 — ничего.
 *
 * У `completed` знак ноль, и это не забывчивость: закрытие вовремя не трогает
 * календарь — диапазон уже прожит, история занятости честная. Досрочный
 * возврат освобождает ОСТАТОК дат, но это граница по дате, а не знак на всём
 * диапазоне, и выразить её здесь нельзя — она живёт в transitionRequest. */
export function availabilityDelta(from: BookingStatus, to: BookingStatus): -1 | 0 | 1 {
  if (!canTransition(from, to)) throw new Error(`illegal transition: ${from} -> ${to}`);
  if (!holdsAvailability(from) && holdsAvailability(to)) return 1;
  if (holdsAvailability(from) && to === "cancelled") return -1;
  return 0;
}
