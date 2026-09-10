// Куда ведёт уведомление и на какую сущность оно ссылается. Модуль чистый —
// типов роутов Next не знает намеренно: слой lib от app не зависит, а href в
// навигации кабинета уже строкой (см. AccountNavItem).
//
// Это единственное место, где живёт полиморфизм entity_id: колонки entity_type
// нет, тип выводится из вида. Разъехаться молча ему не даёт тест, требующий
// адрес у каждого вида списка.

import type { NotificationKind } from "@/lib/notifications/kinds";

export type NotificationEntity = "thread" | "booking_request";

export type NotificationTarget = {
  entity: NotificationEntity;
  href: string;
};

// Отдельного роута на заявку в проекте нет, а списков больше не два: обе роли
// живут одной лентой. Поэтому шесть видов схлопываются в один адрес, и
// entity_id в адресе не участвует.
//
// Адрес НЕ несёт ?role: его сравнивают с usePathname() в RealtimeProvider,
// чтобы не показывать всплывашку о том, что человек и так видит на экране, а
// pathname query не содержит. С параметром это сравнение молча перестало бы
// срабатывать.
export function notificationTarget(
  kind: NotificationKind,
  entityId: string,
): NotificationTarget {
  if (kind === "chat_message") {
    return { entity: "thread", href: `/chat/${entityId}` };
  }
  return { entity: "booking_request", href: "/cabinet/requests" };
}
