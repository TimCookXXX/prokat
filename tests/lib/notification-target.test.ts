import { describe, it, expect } from "vitest";
import { NOTIFICATION_KINDS } from "@/lib/notifications/kinds";
import { notificationTarget } from "@/lib/notifications/target";

describe("куда ведёт уведомление", () => {
  it("сообщение ведёт в свой тред", () => {
    expect(notificationTarget("chat_message", "t1")).toEqual({
      entity: "thread",
      href: "/chat/t1",
    });
  });

  // Списков больше не два: обе роли живут одной лентой, и делить виды по
  // получателю стало незачем.
  it("любая заявка ведёт в общую ленту, независимо от стороны", () => {
    const kinds = [
      "request_created", "request_cancelled",
      "request_confirmed", "request_declined", "request_completed", "request_no_show",
    ] as const;
    for (const kind of kinds) {
      expect(notificationTarget(kind, "r1").href).toBe("/cabinet/requests");
    }
  });

  // Адрес сравнивают с usePathname(), чтобы не показывать всплывашку о том, что
  // человек и так видит. Query туда не попадает, и роль в адресе сломала бы
  // сравнение молча.
  it("адрес не несёт фильтра по роли", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(notificationTarget(kind, "x").href).not.toContain("?");
    }
  });

  it("тип сущности выводится из вида, отдельной колонкой не хранится", () => {
    expect(notificationTarget("chat_message", "x").entity).toBe("thread");
    expect(notificationTarget("request_created", "x").entity).toBe("booking_request");
  });

  // Полиморфизм без внешнего ключа разъезжается молча — этот тест единственное,
  // что заметит вид, добавленный без адреса.
  it("адрес есть у каждого вида", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(notificationTarget(kind, "x").href).toBeTruthy();
    }
  });
});
