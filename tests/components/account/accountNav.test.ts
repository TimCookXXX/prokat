import { describe, it, expect } from "vitest";
import { buildAccountNav } from "@/components/account/accountNav";

describe("buildAccountNav", () => {
  it("groups sections by the role the person is in", () => {
    const groups = buildAccountNav({ newRequestsCount: 2 });
    expect(groups.map((g) => g.title)).toEqual(["сейчас", "мои вещи", "я арендую", "аккаунт"]);
    expect(groups.flatMap((g) => g.items).map((i) => i.href)).toEqual([
      "/cabinet",
      "/cabinet/requests", "/cabinet/listings", "/cabinet/calendar",
      "/requests",
      "/profile",
    ]);
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

  it("drops provider settings and stats tabs", () => {
    const items = buildAccountNav({ newRequestsCount: 0 }).flatMap((g) => g.items);
    expect(items.some((i) => i.href === "/cabinet/settings")).toBe(false);
    expect(items.some((i) => i.href === "/cabinet/stats")).toBe(false);
  });
});

describe("buildAccountNav without the P2P flow", () => {
  it("keeps only the account section", () => {
    const groups = buildAccountNav({ newRequestsCount: 3, p2p: false });
    expect(groups.map((g) => g.title)).toEqual(["аккаунт"]);
    expect(groups.flatMap((g) => g.items).map((i) => i.href)).toEqual(["/profile"]);
  });
});
