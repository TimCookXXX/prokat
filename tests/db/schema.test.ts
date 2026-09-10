import { describe, it, expect } from "vitest";
import * as schema from "@db/schema";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  users, listings, bookingRequests, listingStatus, notifications, notificationKind, notificationSide, chatMessageKind, chatMessages,
} from "@db/schema";
import { NOTIFICATION_KINDS } from "@/lib/notifications/kinds";
import { CHAT_SYSTEM_KINDS } from "@/lib/chat/system-message";

describe("C2C schema shape", () => {
  it("users has verification columns", () => {
    const cols = Object.keys(users);
    expect(cols).toEqual(expect.arrayContaining(["isVerified", "verifiedAt"]));
  });

  it("listings is owned by user and carries city/location", () => {
    const cols = Object.keys(listings);
    expect(cols).toEqual(expect.arrayContaining(["ownerUserId", "cityId", "location"]));
    expect(cols).not.toContain("providerId");
  });

  it("bookingRequests references owner user, not provider", () => {
    const cols = Object.keys(bookingRequests);
    expect(cols).toEqual(expect.arrayContaining(["ownerUserId", "ownerComment"]));
    expect(cols).not.toContain("providerId");
    expect(cols).not.toContain("providerComment");
  });

  it("listingStatus enum has no on_moderation", () => {
    expect(listingStatus.enumValues).toEqual(["active", "hidden", "archived"]);
  });

  it("notifications carries recipient, kind, entity and read cursor", () => {
    const cols = Object.keys(notifications);
    expect(cols).toEqual(
      expect.arrayContaining(["userId", "kind", "side", "entityId", "readAt", "createdAt"]),
    );
    // entity_type сознательно не заводится: kind однозначно задаёт тип сущности,
    // а вторая колонка могла бы с ним разъехаться.
    expect(cols).not.toContain("entityType");
  });

  it("notificationKind enum matches the pure list", () => {
    // Схема и чистый модуль обязаны совпадать: иначе вид, добавленный в одном
    // месте, молча не доедет до другого.
    expect(notificationKind.enumValues).toEqual([...NOTIFICATION_KINDS]);
  });

  // Сторона хранится, а не выводится из вида: вид её не задаёт. Пусто она
  // бывает только у сообщения, поэтому колонка обязана остаться необязательной.
  it("notifications.side знает обе стороны и остаётся необязательной", () => {
    expect(notificationSide.enumValues).toEqual(["owner", "customer"]);
    expect(notifications.side.notNull).toBe(false);
  });

  // Тот же приём, что и с видами уведомлений: список продублирован в схеме и в
  // чистом модуле, и разъехаться им нельзя.
  it("chatMessageKind enum matches the pure list", () => {
    expect(chatMessageKind.enumValues).toEqual(["user", ...CHAT_SYSTEM_KINDS]);
  });

  /* Форму строки держит констрейнт, а не договорённость: на «реплике без
   * автора» правило непрочитанного расходится само с собой — в JS такая строка
   * непрочитана, в SQL выпадает, потому что сравнение с NULL даёт NULL. */
  it("chat_messages держит форму строки констрейнтом", () => {
    const names = getTableConfig(chatMessages).checks.map((c) => c.name);
    expect(names).toContain("chat_messages_kind_shape");
  });

  it("dropped provider/monetization tables are gone", () => {
    expect(schema).not.toHaveProperty("providers");
    expect(schema).not.toHaveProperty("subscriptions");
    expect(schema).not.toHaveProperty("promotions");
    expect(schema).not.toHaveProperty("providerPlan");
  });
});
