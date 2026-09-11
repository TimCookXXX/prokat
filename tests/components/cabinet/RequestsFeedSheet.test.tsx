// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/* Шторка заявки — единственное место, где владелец решает, и единственное, где
 * человек видит условия сделки целиком. Проверяем то, что легко потерять
 * молча: залог показывается ВСЕГДА (в том числе когда его нет — это ответ, а не
 * его отсутствие), количество только когда его больше одного, а сумма считается
 * по цене из самой заявки, а не по сегодняшней цене вещи. */

// Кнопки решения зовут server action — тот тянет next-auth, которого в jsdom нет.
vi.mock("@/server/actions/owner", () => ({
  cancelConfirmedByOwner: vi.fn(), completeRequest: vi.fn(),
  confirmRequest: vi.fn(), declineRequest: vi.fn(),
}));
vi.mock("@/server/actions/booking", () => ({ cancelBookingRequest: vi.fn() }));

const { RequestsFeed } = await import("@/components/cabinet/RequestsFeed");
type Row = Parameters<typeof RequestsFeed>[0]["rows"][number];

const flat = (s: string) => s.replace(/[\s\u00A0\u202F]+/g, " ");

const row = (over: Partial<Row> = {}): Row => ({
  id: "01REQ",
  side: "owner",
  status: "new",
  dateFrom: "2026-09-12",
  dateTo: "2026-09-14",
  qty: 2,
  createdAt: "2026-09-11T10:00:00.000Z",
  expiresAt: "2026-09-12T10:00:00.000Z",
  customerComment: null,
  priceDay: 500,
  depositType: "money",
  depositAmount: 2000,
  listing: {
    id: "01L", title: "Мангал", slug: "mangal", citySlug: "krasnodar",
    categorySlug: "grili", status: "active", ownerBannedAt: null, image: null,
  },
  threadId: null,
  peer: { id: "01P", name: "Мадина" },
  peerPhone: null,
  hot: true,
  estimate: 500 * 3 * 2,
  ...over,
});

/* Шторка монтируется только по клику — на сервере она не рисуется вовсе. Текст
 * читаем из всего документа, а не из container: шторка уезжает в портал, и
 * поддерева, которое вернул render, в ней нет. */
function openSheet(r: Row) {
  const view = render(<RequestsFeed rows={[r]} />);
  fireEvent.click(screen.getAllByText("Мангал")[0]);
  return view;
}

const sheetText = () => flat(document.body.textContent ?? "");

describe("шторка заявки", () => {
  it("залог показывается всегда", () => {
    openSheet(row());
    expect(screen.getByText("Залог")).toBeTruthy();
  });

  // «Не нужен» — это ответ на вопрос о залоге, а не отсутствие ответа.
  it("залога нет — так и говорит, а строку не прячет", () => {
    openSheet(row({ depositType: "none", depositAmount: null }));
    expect(screen.getByText("Залог")).toBeTruthy();
    expect(screen.getByText("Не нужен")).toBeTruthy();
  });

  it("количество показывается только когда его больше одного", () => {
    const { unmount } = openSheet(row({ qty: 2 }));
    expect(screen.getByText("Сколько")).toBeTruthy();
    unmount();

    openSheet(row({ qty: 1, estimate: 500 * 3 }));
    expect(screen.queryByText("Сколько")).toBeNull();
  });

  // Границы диапазона включительные: 12–14 сентября — трое суток.
  it("период называет число суток", () => {
    openSheet(row());
    expect(sheetText()).toContain("3 дня");
  });

  /* Раскладка обязательна: «≈ 3 000 ₽» человек сверяет в уме, а сутки у нас
   * включают обе границы — счёт в уме расходится на день. */
  it("показывает, из чего сложилась сумма", () => {
    openSheet(row());
    const text = sheetText();
    expect(text).toContain("≈ 3 000 ₽");
    expect(text).toContain("500 ₽");
    expect(text).toContain("× 3 дня");
    expect(text).toContain("× 2 шт.");
  });

  // Сервис денег не проводит — рядом с суммами это обязано быть сказано.
  it("предупреждает, что оплата и залог мимо сервиса", () => {
    openSheet(row());
    expect(sheetText()).toContain("сервис их не проводит");
  });
});
