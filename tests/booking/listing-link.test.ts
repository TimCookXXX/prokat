import { describe, it, expect } from "vitest";
import { requestListingHref, type LinkableListing } from "@/lib/booking/listing-link";

// Заявка живёт дольше объявления: вещь скрыли, убрали в архив или забанили
// владельца, а строка в ленте осталась. Публичная страница таких не пускает —
// ссылка туда вела бы в 404.
describe("requestListingHref", () => {
  const PUBLIC_PATH = "/kazan/dreli/drel-bosch-01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const CABINET_PATH = "/cabinet/listings/01ARZ3NDEKTSV4RRFFQ69G5FAV";

  const listing = (over: Partial<LinkableListing> = {}): LinkableListing => ({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "drel-bosch",
    citySlug: "kazan",
    categorySlug: "dreli",
    status: "active",
    ownerBannedAt: null,
    ...over,
  });

  it("у видимой вещи ведёт на публичную страницу обеими сторонами", () => {
    expect(requestListingHref(listing(), "owner")).toBe(PUBLIC_PATH);
    expect(requestListingHref(listing(), "customer")).toBe(PUBLIC_PATH);
  });

  it.each(["hidden", "archived"] as const)(
    "статус %s: владельцу кабинет, арендатору ничего",
    (status) => {
      expect(requestListingHref(listing({ status }), "owner")).toBe(CABINET_PATH);
      expect(requestListingHref(listing({ status }), "customer")).toBeNull();
    },
  );

  /* Статуса мало: правило публичного контура шире. Активное объявление
   * забаненного владельца страница тоже не отдаёт, а поднять его в active
   * админ может вручную — тогда статус с баном расходятся. */
  it("бан владельца закрывает ссылку даже у активной вещи", () => {
    const banned = listing({ ownerBannedAt: new Date("2026-09-01") });
    expect(requestListingHref(banned, "owner")).toBe(CABINET_PATH);
    expect(requestListingHref(banned, "customer")).toBeNull();
  });
});
