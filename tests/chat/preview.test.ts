import { describe, it, expect } from "vitest";
import { messagePreview, toPreview } from "@/server/chat";
import { newSortableId } from "@/lib/id";

describe("toPreview()", () => {
  it("схлопывает переносы и лишние пробелы в одну строку", () => {
    expect(toPreview("привет\n\nкак дела?  ")).toBe("привет как дела?");
  });

  it("короткое сообщение оставляет как есть", () => {
    expect(toPreview("ок")).toBe("ок");
  });

  it("длинное обрезает и ставит многоточие", () => {
    const preview = toPreview("я".repeat(300));
    expect(preview).toHaveLength(201);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("ровно на границе не обрезает", () => {
    const exact = "я".repeat(200);
    expect(toPreview(exact)).toBe(exact);
  });
});

describe("newSortableId()", () => {
  // id сообщения — единственный ключ сортировки ленты и курсор пагинации.
  // Обычный ulid() внутри одной миллисекунды упорядочен не был бы.
  it("возрастает даже когда id выданы подряд в одну миллисекунду", () => {
    const ids = Array.from({ length: 50 }, () => newSortableId());
    expect([...ids].sort()).toEqual(ids);
  });
});

/* Превью последней строки треда. У записи о сделке текста в базе нет: тред, где
 * последней была запись, всплывает наверх списка, и без сборки строки человек
 * увидел бы там пустоту. */
describe("messagePreview", () => {
  it("реплику показывает как есть", () => {
    expect(messagePreview({ kind: "user", body: "привет", meta: null })).toBe("привет");
  });

  it("запись о сделке собирает из вида и meta", () => {
    const line = messagePreview({
      kind: "request_confirmed",
      body: null,
      meta: { from: "2026-09-12", to: "2026-09-14" },
    });
    expect(line.replace(/ /g, " ")).toBe("Заявка подтверждена: 12 сентября — 14 сентября");
  });

  it("запись без meta не оставляет пустую строку", () => {
    expect(messagePreview({ kind: "request_declined", body: null, meta: null }))
      .toBe("Заявка отклонена");
  });

  it("реплика без текста даёт пустую строку, а не падает", () => {
    expect(messagePreview({ kind: "user", body: null, meta: null })).toBe("");
  });
});
