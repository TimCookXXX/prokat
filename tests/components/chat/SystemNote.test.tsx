// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemNote } from "@/components/chat/FeedDividers";
import type { ChatSystemMeta } from "@/lib/chat/system-message";

/* Записей в журнале два рисунка, и различие смысловое, а не декоративное.
 *
 * Заявка — карточка со списком условий: это единственная запись, у которой
 * есть что перечислять, и ради неё человек в тред и приходит. Решения по ней
 * остаются плашкой: перечислять нечего, а четыре одинаковые карточки подряд
 * забили бы ленту.
 *
 * Без этого теста любой позднейший рефактор схлопнет их обратно в один вид
 * молча — оба рисунка собирает одна функция. */

const meta: ChatSystemMeta = {
  requestId: "01REQ",
  from: "2026-09-12", to: "2026-09-14", qty: 2,
  priceDay: 500, depositType: "money", depositAmount: 2000,
  comment: "Заберу вечером",
};

// formatPrice разделяет разряды неразрывными пробелами, formatDayMonth тоже —
// сводим любой пробельный символ к обычному, иначе тест падает на невидимой
// разнице между «3 000 ₽» и «3 000 ₽».
const flat = (s: string) => s.replace(/[\s\u00A0\u202F]+/g, " ");

describe("SystemNote — заявка", () => {
  it("рисуется карточкой: подписи условий на месте", () => {
    render(<ul><SystemNote message={{ kind: "request_created", meta }} /></ul>);
    for (const term of ["Даты", "Сколько", "Стоимость", "Залог"]) {
      expect(screen.getByText(term)).toBeTruthy();
    }
  });

  it("сумма считается по цене из записи", () => {
    render(<ul><SystemNote message={{ kind: "request_created", meta }} /></ul>);
    // 500 × 3 дня (границы включительно) × 2 шт.
    expect(flat(screen.getByText(/≈/).textContent ?? "")).toContain("3 000 ₽");
  });

  it("комментарий клиента виден", () => {
    render(<ul><SystemNote message={{ kind: "request_created", meta }} /></ul>);
    expect(screen.getByText("Заберу вечером")).toBeTruthy();
  });

  /* Живого статуса у записи нет — она про момент, а не про «сейчас». Ссылка
   * отвечает на «а что с ней стало» единственным честным способом: показывает
   * саму заявку. */
  it("ведёт в шторку своей заявки", () => {
    render(<ul><SystemNote message={{ kind: "request_created", meta }} /></ul>);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/cabinet/requests?request=01REQ");
  });

  // Заявки старше журнала идентификатора в meta не несут: вести некуда, но и
  // падать не из-за чего.
  it("без requestId остаётся карточкой, только без ссылки", () => {
    const { container } = render(
      <ul><SystemNote message={{ kind: "request_created", meta: { ...meta, requestId: undefined } }} /></ul>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("Даты");
  });
});

describe("SystemNote — решения по заявке", () => {
  it.each(["request_confirmed", "request_declined", "request_cancelled", "request_completed"])(
    "%s остаётся плашкой без списка условий",
    (kind) => {
      const { container } = render(<ul><SystemNote message={{ kind, meta }} /></ul>);
      // Ни подписей карточки, ни ссылки — только название события и даты.
      expect(container.textContent).not.toContain("Залог");
      expect(container.textContent).not.toContain("Стоимость");
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("даты решение всё-таки называет — без них запись не привязана ни к чему", () => {
    const { container } = render(
      <ul><SystemNote message={{ kind: "request_confirmed", meta }} /></ul>,
    );
    expect(flat(container.textContent ?? "")).toContain("12 сентября — 14 сентября");
  });
});
