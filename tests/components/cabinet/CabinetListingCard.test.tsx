import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CabinetListingCard } from "@/components/cabinet/CabinetListingCard";
import type { AvailabilityMap } from "@/lib/catalog/availability";

// Кнопки статуса приходят пропом, поэтому карточка не тянет server action и
// рендерится в jsdom без заглушек — ради этого проп и заведён.

const TODAY = "2026-09-04";
const ITEM_HREF = "/cabinet/listings/01ARZ3NDEKTSV4RRFFQ69G5FAW";

function card({
  status = "active", quantity = 3, booked = 0,
}: {
  status?: "active" | "hidden" | "archived";
  quantity?: number;
  booked?: number;
} = {}) {
  const listing = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
    slug: "perforator",
    title: "Перфоратор Bosch GBH 2-26",
    status,
    quantity,
    priceDay: 500,
    depositType: "money",
    depositAmount: 3000,
    photosJson: [],
  } as never;

  const availability: AvailabilityMap = new Map(
    booked > 0 ? [[TODAY, { bookedQty: booked, blockedQty: 0 }]] : [],
  );

  return (
    <CabinetListingCard
      listing={listing}
      availabilityMap={availability}
      from={TODAY}
      actions={<button type="button">Действие</button>}
    />
  );
}

const title = () => screen.getByRole("link", { name: /Перфоратор/ });

describe("CabinetListingCard", () => {
  it("показывает статус на фото", () => {
    const { unmount } = render(card());
    expect(screen.getByText("Активно")).toBeInTheDocument();
    unmount();

    render(card({ status: "archived" }));
    expect(screen.getByText("Архив")).toBeInTheDocument();
  });

  // Единственный вход на страницу вещи: занятость, заявки и переписки по ней
  // живут там, а карандаш ведёт сразу в форму. На витрину ссылка есть уже
  // со страницы вещи.
  it("карточка ведёт на страницу вещи при любом статусе", () => {
    for (const status of ["active", "hidden", "archived"] as const) {
      const { unmount } = render(card({ status }));
      expect(title()).toHaveAttribute("href", ITEM_HREF);
      unmount();
    }
  });

  // Плашка занятости у неактивных врала бы: строк занятости у них обычно нет,
  // а freeQty без строки возвращает всё количество.
  it("плашка занятости только у активных", () => {
    const { unmount } = render(card());
    expect(screen.getByText("Свободно")).toBeInTheDocument();
    unmount();

    render(card({ status: "archived" }));
    expect(screen.queryByText("Свободно")).toBeNull();
  });

  // В отличие от витрины плашка несёт число: больше quantity на этой странице
  // взять негде.
  it("при частичной занятости показывает остаток числом", () => {
    render(card({ quantity: 3, booked: 1 }));
    expect(screen.getByText("Свободно 2 из 3")).toBeInTheDocument();
  });

  it("когда свободных единиц нет — «Занято»", () => {
    render(card({ quantity: 2, booked: 2 }));
    expect(screen.getByText("Занято")).toBeInTheDocument();
  });

  // Действия лежат оверлеем на фото, а не подвалом под телом карточки — это и
  // позволило поставить две колонки на телефоне. Проверяем именно расположение:
  // кнопка обязана быть внутри обёртки снимка, иначе оверлей уехал.
  it("рисует действия поверх фото, а не отдельной полосой", () => {
    const { container } = render(card());
    const photo = container.querySelector(".aspect-\\[3\\/2\\]")?.parentElement;
    expect(photo).not.toBeNull();
    expect(photo!.contains(screen.getByRole("button", { name: "Действие" }))).toBe(true);
  });
});
