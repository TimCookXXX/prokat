import { describe, it, expect } from "vitest";
import {
  isSystemKind, systemMessageLine, systemMessageText, CHAT_SYSTEM_KINDS,
} from "@/lib/chat/system-message";

// Неразрывные пробелы внутри дат сравнивать неудобно — нормализуем.
const flat = (s: string) => s.replace(/ /g, " ");

describe("isSystemKind", () => {
  it("реплика человека системной не считается", () => {
    expect(isSystemKind("user")).toBe(false);
  });

  it("все виды записей опознаются", () => {
    for (const kind of CHAT_SYSTEM_KINDS) expect(isSystemKind(kind)).toBe(true);
  });

  it("незнакомый вид системным не становится", () => {
    expect(isSystemKind("request_expired")).toBe(false);
  });
});

describe("systemMessageText", () => {
  const meta = { requestId: "01REQ", from: "2026-09-12", to: "2026-09-14", qty: 1 };

  it("даёт заголовок и период", () => {
    const r = systemMessageText("request_created", meta);
    expect(r.title).toBe("Заявка на бронь");
    expect(flat(r.detail ?? "")).toBe("12 сентября — 14 сентября");
  });

  it("один день не превращается в диапазон", () => {
    const r = systemMessageText("request_confirmed", { ...meta, from: "2026-09-12", to: "2026-09-12" });
    expect(flat(r.detail ?? "")).toBe("12 сентября");
  });

  it("количество показывается только когда его больше одного", () => {
    expect(flat(systemMessageText("request_created", { ...meta, qty: 3 }).detail ?? ""))
      .toContain("3 шт.");
    expect(systemMessageText("request_created", meta).detail).not.toContain("шт.");
  });

  /* Заявка живёт дольше своих данных: meta у старых записей может не быть, а
   * лента обязана дочитаться, а не упасть. */
  it("без meta остаётся один заголовок", () => {
    expect(systemMessageText("request_declined", null)).toEqual({
      title: "Заявка отклонена", detail: null, comment: null,
    });
    expect(systemMessageText("request_declined", { requestId: "01REQ" }).detail).toBeNull();
  });

  it("у каждого вида есть свой текст", () => {
    const titles = CHAT_SYSTEM_KINDS.map((k) => systemMessageText(k, null).title);
    expect(new Set(titles).size).toBe(CHAT_SYSTEM_KINDS.length);
    expect(titles.every(Boolean)).toBe(true);
  });
});

describe("systemMessageLine", () => {
  it("собирает превью одной строкой", () => {
    expect(flat(systemMessageLine("request_confirmed", { from: "2026-09-12", to: "2026-09-14" })))
      .toBe("Заявка подтверждена: 12 сентября — 14 сентября");
  });

  it("без периода — только заголовок, без двоеточия в пустоту", () => {
    expect(systemMessageLine("request_cancelled", null)).toBe("Бронь отменена");
  });
});

/* Комментарий клиента живёт в meta записи и показывается в переписке. В базе
 * он копия колонки заявки: колонку читает шторка в момент решения, эту —
 * тред. Записан один раз, одной транзакцией — разъехаться им негде. */
describe("systemMessageText: комментарий", () => {
  const meta = { requestId: "01REQ", from: "2026-09-12", to: "2026-09-14" };

  it("отдаётся отдельно от заголовка и периода", () => {
    const r = systemMessageText("request_created", { ...meta, comment: "Нужен к 9 утра" });
    expect(r.title).toBe("Заявка на бронь");
    expect(r.comment).toBe("Нужен к 9 утра");
  });

  it("пустой и пробельный комментарий — это его отсутствие", () => {
    expect(systemMessageText("request_created", { ...meta, comment: "" }).comment).toBeNull();
    expect(systemMessageText("request_created", { ...meta, comment: "   " }).comment).toBeNull();
    expect(systemMessageText("request_created", meta).comment).toBeNull();
  });

  // Записи старше этого изменения комментария не имеют — лента обязана их
  // дочитывать, а не падать.
  it("запись без комментария читается как раньше", () => {
    const r = systemMessageText("request_confirmed", meta);
    expect(r.comment).toBeNull();
    expect(flat(r.detail ?? "")).toBe("12 сентября — 14 сентября");
  });

  // Превью в списке переписок остаётся стабильным: комментарий бывает длинным,
  // и строка списка прыгала бы от заявки к заявке.
  it("в превью комментарий не попадает", () => {
    expect(systemMessageLine("request_created", { ...meta, comment: "Нужен к 9 утра" }))
      .not.toContain("9 утра");
  });
});
