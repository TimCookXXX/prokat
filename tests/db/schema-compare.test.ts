import { describe, it, expect } from "vitest";
import { offers, rentalShops, leadType, shopStatus, verifiedBy } from "@db/schema";

describe("comparison schema", () => {
  it("offer keeps unknown deposit distinct from zero", () => {
    expect(offers.depositRub.notNull).toBe(false);
    expect(offers.priceDay.notNull).toBe(false); // понедельные прокаты
    expect(offers.verifiedAt.notNull).toBe(true);
  });

  it("shop exists without an owner", () => {
    expect(rentalShops.ownerUserId.notNull).toBe(false);
    expect(shopStatus.enumValues).toEqual(["unclaimed", "claimed", "hidden"]);
  });

  it("enums match the data model", () => {
    expect(verifiedBy.enumValues).toEqual(["call", "site", "listing", "shop"]);
    expect(leadType.enumValues).toEqual([
      "show_phone", "call", "request", "regular_request", "price_outdated", "claim_click",
    ]);
  });
});
