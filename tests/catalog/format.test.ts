import { describe, it, expect } from "vitest";
import { formatDeposit, formatHandover, formatHandoverShort } from "@/lib/catalog/format";

describe("formatHandover()", () => {
  it("оба способа — выбор остаётся за людьми", () => {
    expect(formatHandover(true, true)).toBe("Самовывоз или доставка");
  });

  it("только самовывоз", () => {
    expect(formatHandover(true, false)).toBe("Только самовывоз");
  });

  it("только доставка", () => {
    expect(formatHandover(false, true)).toBe("Только доставка");
  });

  // Валидация такого не пропустит, но колонки правятся не только формой, и
  // выдавать отсутствие данных за «только самовывоз» карточка не должна.
  it("ни одного способа — говорит об этом прямо, а не выдумывает самовывоз", () => {
    expect(formatHandover(false, false)).toBe("По договорённости");
  });

  // Значение стоит к подписи «Получение» в блоке брони, где на строку есть
  // половина ширины: развёрнутая фраза с точкой её распирала.
  it("подписи короткие и без точки", () => {
    for (const [p, d] of [[true, true], [true, false], [false, true], [false, false]]) {
      const label = formatHandover(p, d);
      expect(label.endsWith(".")).toBe(false);
      expect(label.length).toBeLessThanOrEqual(24);
    }
  });
});

// В подвале карточки «Только» лишнее: там перечисляют, чем вещь отличается от
// соседних в ряду, а не предупреждают об ограничении.
describe("formatHandoverShort()", () => {
  it("оба способа названы так же, как в блоке брони", () => {
    expect(formatHandoverShort(true, true)).toBe("Самовывоз / доставка");
  });

  it("единственный способ — без слова «Только»", () => {
    expect(formatHandoverShort(true, false)).toBe("Самовывоз");
    expect(formatHandoverShort(false, true)).toBe("Доставка");
  });

  it("ни одного способа — говорит об этом прямо", () => {
    expect(formatHandoverShort(false, false)).toBe("По договорённости");
  });
});

// Тип «деньги» без суммы достижим: в форме поле необязательное, а ноль она
// принимает. Голое слово «залог» не сообщало ничего.
describe("formatDeposit: деньги без суммы", () => {
  it("ноль и пустое поле называются вслух", () => {
    expect(formatDeposit("money", 0)).toBe("залог не указан");
    expect(formatDeposit("money", null)).toBe("залог не указан");
  });

  it("сумма показывается, когда она есть", () => {
    // Разряды formatPrice разделяет неразрывным пробелом — в ожидании он
    // приводится к обычному, иначе тест падает на невидимой разнице.
    expect(formatDeposit("money", 3000).replace(/\u00A0/g, " ")).toBe("залог 3 000 ₽");
  });
});
