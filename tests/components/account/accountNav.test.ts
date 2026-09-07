import { describe, it, expect } from "vitest";
import { buildAccountNav } from "@/components/account/accountNav";

describe("buildAccountNav", () => {
  // Ролевого деления больше нет: заявки обеих сторон живут одной лентой, «я
  // арендую» исчез вместе с ней, занятость уехала внутрь вещи. Группировать
  // стало нечем — кабинет плоский.
  it("отдаёт один список без заголовков", () => {
    const groups = buildAccountNav({ newRequestsCount: 2 });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBeUndefined();
    expect(groups[0]!.items.map((i) => i.href)).toEqual([
      "/cabinet", "/cabinet/requests", "/chat", "/cabinet/listings", "/profile",
    ]);
  });

  it("отдельного раздела для роли арендатора не осталось", () => {
    const items = buildAccountNav({ newRequestsCount: 0 }).flatMap((g) => g.items);
    expect(items.some((i) => i.href === "/requests")).toBe(false);
  });



  it("badges unread messages on the chat section", () => {
    const items = buildAccountNav({ newRequestsCount: 0, unreadMessages: 4 })
      .flatMap((g) => g.items);
    expect(items.find((i) => i.href === "/chat")!.badge).toBe(4);
  });

  it("omits the chat badge when everything is read", () => {
    const items = buildAccountNav({ newRequestsCount: 0, unreadMessages: 0 })
      .flatMap((g) => g.items);
    expect(items.find((i) => i.href === "/chat")!.badge).toBeFalsy();
  });

  it("matches the summary exactly — /cabinet prefixes every other section", () => {
    const summary = buildAccountNav({ newRequestsCount: 0 })
      .flatMap((g) => g.items)
      .find((i) => i.href === "/cabinet")!;
    expect(summary.exact).toBe(true);
  });

  it("counts pending requests only on the owner inbox", () => {
    const items = buildAccountNav({ newRequestsCount: 2 }).flatMap((g) => g.items);
    expect(items.find((i) => i.href === "/cabinet/requests")!.badge).toBe(2);
    expect(items.filter((i) => i.badge).length).toBe(1);
  });

  // Бейджи считают разное и схлопываться в одно число не должны: сообщения по
  // штукам, заявки — только входящие.
  it("keeps the badges independent", () => {
    const items = buildAccountNav({ newRequestsCount: 2, unreadMessages: 7 })
      .flatMap((g) => g.items);
    expect(items.find((i) => i.href === "/chat")!.badge).toBe(7);
    expect(items.find((i) => i.href === "/cabinet/requests")!.badge).toBe(2);
  });

  it("writes hub hints in humane Russian and omits them at zero", () => {
    const items = buildAccountNav({
      newRequestsCount: 0, activeListings: 3,
    }).flatMap((g) => g.items);
    expect(items.find((i) => i.href === "/cabinet/listings")!.hint).toBe("3");

    const bare = buildAccountNav({ newRequestsCount: 0 }).flatMap((g) => g.items);
    expect(bare.every((i) => i.hint === undefined)).toBe(true);
  });

  it("drops provider settings and stats tabs", () => {
    const items = buildAccountNav({ newRequestsCount: 0 }).flatMap((g) => g.items);
    expect(items.some((i) => i.href === "/cabinet/settings")).toBe(false);
    expect(items.some((i) => i.href === "/cabinet/stats")).toBe(false);
  });
});
