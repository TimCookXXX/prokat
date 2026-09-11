import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_KINDS, kindForDecision, notificationRecipient,
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
    ]);
  });

  it("решение владельца превращается в вид", () => {
    expect(kindForDecision("confirmed")).toBe("request_confirmed");
    expect(kindForDecision("declined")).toBe("request_declined");
    expect(kindForDecision("completed")).toBe("request_completed");
    expect(kindForDecision("cancelled")).toBe("request_cancelled");
  });

  it("любое решение владельца даёт вид из общего списка", () => {
    for (const to of ["confirmed", "declined", "completed", "cancelled"] as const) {
      expect(NOTIFICATION_KINDS).toContain(kindForDecision(to));
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
