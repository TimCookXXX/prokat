import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_KINDS, kindForDecision, notificationRecipient, sideForKind,
} from "@/lib/notifications/kinds";

describe("виды уведомлений", () => {
  it("список закрыт и упорядочен", () => {
    expect([...NOTIFICATION_KINDS]).toEqual([
      "chat_message",
      "request_created",
      "request_cancelled",
      "request_confirmed",
      "request_declined",
      "request_completed",
      "request_no_show",
    ]);
  });

  it("решение владельца превращается в вид", () => {
    expect(kindForDecision("confirmed")).toBe("request_confirmed");
    expect(kindForDecision("declined")).toBe("request_declined");
    expect(kindForDecision("completed")).toBe("request_completed");
    expect(kindForDecision("no_show")).toBe("request_no_show");
  });

  it("любое решение владельца даёт вид из общего списка", () => {
    for (const to of ["confirmed", "declined", "completed", "no_show"] as const) {
      expect(NOTIFICATION_KINDS).toContain(kindForDecision(to));
    }
  });
});

// Сторона решает, гасить ли всплывашку: лента фильтруется по роли, и событие
// чужой стороны при активном фильтре на экран не попадает.
describe("сторона события", () => {
  it("создание и отмена — сторона владельца", () => {
    expect(sideForKind("request_created")).toBe("owner");
    expect(sideForKind("request_cancelled")).toBe("owner");
  });

  it("решения владельца — сторона арендатора", () => {
    for (const kind of ["request_confirmed", "request_declined", "request_completed", "request_no_show"] as const) {
      expect(sideForKind(kind)).toBe("customer");
    }
  });

  it("сторона есть у каждого вида заявки", () => {
    for (const kind of NOTIFICATION_KINDS) {
      if (kind === "chat_message") continue;
      expect(["owner", "customer"]).toContain(sideForKind(kind));
    }
  });
});

describe("получатель уведомления", () => {
  // Совпадение сторон схема не запрещает — почему охранник нужен, объяснено в
  // server/notifications.ts.
  it("действующее лицо о собственном действии не уведомляется", () => {
    expect(notificationRecipient("u1", "u1")).toBeNull();
  });

  it("вторая сторона уведомляется", () => {
    expect(notificationRecipient("u2", "u1")).toBe("u2");
  });

  it("отсутствующий собеседник уведомления не рождает", () => {
    expect(notificationRecipient(null, "u1")).toBeNull();
  });
});
