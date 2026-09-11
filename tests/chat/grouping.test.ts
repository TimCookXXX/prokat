import { describe, it, expect } from "vitest";
import {
  buildFeed, dayLabel, unreadAnchor, filterThreads,
  type FeedMessage, type ThreadSummary,
} from "@/lib/chat/grouping";

const ME = "01ME";
const THEM = "01THEM";

// id монотонны по времени (ULID), поэтому в тестах их удобно задавать вручную.
const msg = (id: string, sender: string, minutes: number, body = "текст"): FeedMessage => ({
  id,
  senderUserId: sender,
  kind: "user",
  body,
  meta: null,
  createdAt: new Date(`2026-08-31T10:${String(minutes).padStart(2, "0")}:00`),
});

// Запись о сделке: отправителя и текста нет, всё нужное лежит в meta.
const note = (id: string, minutes: number, kind: FeedMessage["kind"] = "request_created"): FeedMessage => ({
  id,
  senderUserId: null,
  kind,
  body: null,
  meta: { requestId: "01REQ", from: "2026-09-12", to: "2026-09-14", qty: 1 },
  createdAt: new Date(`2026-08-31T10:${String(minutes).padStart(2, "0")}:00`),
});

describe("dayLabel()", () => {
  const now = new Date("2026-08-31T12:00:00");

  it("сегодняшнее называет «Сегодня»", () => {
    expect(dayLabel(new Date("2026-08-31T08:00:00"), now)).toBe("Сегодня");
  });

  it("вчерашнее называет «Вчера»", () => {
    expect(dayLabel(new Date("2026-08-30T23:59:00"), now)).toBe("Вчера");
  });

  it("более раннее — числом и месяцем", () => {
    expect(dayLabel(new Date("2026-08-28T10:00:00"), now)).toBe("28 августа");
  });

  // Год важен: «28 августа» без года у прошлогодней переписки — враньё.
  it("прошлогоднее — с годом", () => {
    expect(dayLabel(new Date("2025-08-28T10:00:00"), now)).toBe("28 августа 2025");
  });

  // Границу дня считаем по локальному календарю, а не по разнице в часах.
  it("час назад, но вчера по календарю — «Вчера»", () => {
    expect(dayLabel(new Date("2026-08-30T23:30:00"), new Date("2026-08-31T00:30:00"))).toBe("Вчера");
  });
});

describe("buildFeed(): группировка", () => {
  it("подряд идущие сообщения одного автора в пределах 5 минут — одна группа", () => {
    const feed = buildFeed([msg("01A", ME, 0), msg("01B", ME, 3)], { viewerId: ME });
    const groups = feed.filter((i) => i.kind === "group");
    expect(groups).toHaveLength(1);
    expect(groups[0].kind === "group" && groups[0].messages).toHaveLength(2);
  });

  it("разрыв больше 5 минут разбивает группу", () => {
    const feed = buildFeed([msg("01A", ME, 0), msg("01B", ME, 6)], { viewerId: ME });
    expect(feed.filter((i) => i.kind === "group")).toHaveLength(2);
  });

  it("смена автора разбивает группу", () => {
    const feed = buildFeed([msg("01A", ME, 0), msg("01B", THEM, 1)], { viewerId: ME });
    const groups = feed.filter((i) => i.kind === "group");
    expect(groups).toHaveLength(2);
    expect(groups[0].kind === "group" && groups[0].mine).toBe(true);
    expect(groups[1].kind === "group" && groups[1].mine).toBe(false);
  });

  it("группа помнит, моя она или чужая", () => {
    const feed = buildFeed([msg("01A", THEM, 0)], { viewerId: ME });
    expect(feed[0].kind === "group" && feed[0].mine).toBe(false);
  });
});

describe("buildFeed(): разделители дат", () => {
  const now = new Date("2026-08-31T12:00:00");

  it("ставит разделитель перед первым сообщением", () => {
    const feed = buildFeed([msg("01A", ME, 0)], { viewerId: ME, now });
    expect(feed[0].kind).toBe("date");
  });

  it("ставит разделитель на смене дня и не ставит внутри дня", () => {
    const yesterday: FeedMessage = {
      id: "01A", senderUserId: ME, body: "вчера", kind: "user", meta: null,
      createdAt: new Date("2026-08-30T10:00:00"),
    };
    const feed = buildFeed([yesterday, msg("01B", ME, 0), msg("01C", ME, 1)], { viewerId: ME, now });
    const dates = feed.filter((i) => i.kind === "date");
    expect(dates).toHaveLength(2);
    expect(dates[0].kind === "date" && dates[0].label).toBe("Вчера");
    expect(dates[1].kind === "date" && dates[1].label).toBe("Сегодня");
  });

  // Смена дня рвёт группу, даже если автор тот же и разрыв меньше пяти минут:
  // иначе пузыри одной группы оказались бы по разные стороны разделителя.
  it("смена дня разбивает группу", () => {
    const late: FeedMessage = {
      id: "01A", senderUserId: ME, body: "ночью", kind: "user", meta: null,
      createdAt: new Date("2026-08-30T23:59:00"),
    };
    const early: FeedMessage = {
      id: "01B", senderUserId: ME, body: "утром", kind: "user", meta: null,
      createdAt: new Date("2026-08-31T00:01:00"),
    };
    const feed = buildFeed([late, early], { viewerId: ME, now });
    expect(feed.filter((i) => i.kind === "group")).toHaveLength(2);
  });
});

describe("buildFeed(): разделитель непрочитанного", () => {
  it("ставит его перед якорем и считает непрочитанные", () => {
    const feed = buildFeed(
      [msg("01A", THEM, 0), msg("01B", THEM, 10), msg("01C", THEM, 20)],
      { viewerId: ME, unreadAnchorId: "01B" },
    );
    const idx = feed.findIndex((i) => i.kind === "unread");
    expect(idx).toBeGreaterThan(-1);
    const unread = feed[idx];
    expect(unread.kind === "unread" && unread.count).toBe(2);
    // Сразу за разделителем идёт группа, начинающаяся с якоря.
    const next = feed.slice(idx + 1).find((i) => i.kind === "group");
    expect(next?.kind === "group" && next.messages[0].id).toBe("01B");
  });

  it("без якоря разделителя нет", () => {
    const feed = buildFeed([msg("01A", THEM, 0)], { viewerId: ME });
    expect(feed.some((i) => i.kind === "unread")).toBe(false);
  });

  it("якорь рвёт группу, чтобы разделитель не оказался внутри неё", () => {
    const feed = buildFeed(
      [msg("01A", THEM, 0), msg("01B", THEM, 1)],
      { viewerId: ME, unreadAnchorId: "01B" },
    );
    expect(feed.filter((i) => i.kind === "group")).toHaveLength(2);
  });

  it("свои сообщения в счётчик не попадают", () => {
    const feed = buildFeed(
      [msg("01A", THEM, 0), msg("01B", ME, 10), msg("01C", THEM, 20)],
      { viewerId: ME, unreadAnchorId: "01A" },
    );
    const unread = feed.find((i) => i.kind === "unread");
    expect(unread?.kind === "unread" && unread.count).toBe(2);
  });
});

describe("buildFeed(): устойчивость к порядку", () => {
  // В задаче 2 массив начнёт доливать сокет, и порядок прихода не гарантирован.
  it("одинаково собирает ленту из перемешанного массива", () => {
    const ordered = [msg("01A", ME, 0), msg("01B", THEM, 1), msg("01C", THEM, 2)];
    const shuffled = [ordered[2], ordered[0], ordered[1]];
    const now = new Date("2026-08-31T12:00:00");
    expect(buildFeed(shuffled, { viewerId: ME, now }))
      .toEqual(buildFeed(ordered, { viewerId: ME, now }));
  });

  it("на пустом массиве отдаёт пустую ленту, а не разделитель в воздухе", () => {
    expect(buildFeed([], { viewerId: ME })).toEqual([]);
  });
});

describe("unreadAnchor()", () => {
  const messages = [msg("01A", THEM, 0), msg("01B", ME, 1), msg("01C", THEM, 2)];

  it("без курсора непрочитано всё с первого чужого", () => {
    expect(unreadAnchor(messages, null, ME)).toBe("01A");
  });

  it("с курсором — первое чужое после него", () => {
    expect(unreadAnchor(messages, "01A", ME)).toBe("01C");
  });

  it("когда всё прочитано — null", () => {
    expect(unreadAnchor(messages, "01C", ME)).toBeNull();
  });

  // Свои сообщения непрочитанными не бывают: они не должны становиться якорем.
  it("своё сообщение якорем не становится", () => {
    expect(unreadAnchor([msg("01A", ME, 0)], null, ME)).toBeNull();
  });
});

describe("filterThreads()", () => {
  const thread = (over: Partial<ThreadSummary>): ThreadSummary => ({
    counterpartName: "Иван",
    listingTitle: "Дрель Bosch",
    preview: "свободна на выходных",
    unread: 0,
    iAmOwner: false,
    ...over,
  });

  const threads = [
    thread({}),
    thread({ counterpartName: "Мария", listingTitle: "Палатка", preview: "заберу завтра", unread: 3 }),
    thread({ counterpartName: "Пётр", listingTitle: "Мангал", preview: "спасибо", iAmOwner: true }),
  ];

  it("без запроса и с фильтром «все» отдаёт всё", () => {
    expect(filterThreads(threads, "", "all")).toHaveLength(3);
  });

  it("ищет по имени собеседника", () => {
    expect(filterThreads(threads, "мар", "all").map((t) => t.counterpartName)).toEqual(["Мария"]);
  });

  it("ищет по названию вещи", () => {
    expect(filterThreads(threads, "мангал", "all").map((t) => t.counterpartName)).toEqual(["Пётр"]);
  });

  it("ищет по превью", () => {
    expect(filterThreads(threads, "завтра", "all").map((t) => t.counterpartName)).toEqual(["Мария"]);
  });

  it("регистр и пробелы по краям не мешают", () => {
    expect(filterThreads(threads, "  ИВАН  ", "all")).toHaveLength(1);
  });

  it("фильтр «непрочитанные» оставляет только их", () => {
    expect(filterThreads(threads, "", "unread").map((t) => t.counterpartName)).toEqual(["Мария"]);
  });

  it("фильтр «мои вещи» оставляет переписки, где я владелец", () => {
    expect(filterThreads(threads, "", "mine").map((t) => t.counterpartName)).toEqual(["Пётр"]);
  });

  it("фильтр и поиск работают вместе", () => {
    expect(filterThreads(threads, "палатка", "unread")).toHaveLength(1);
    expect(filterThreads(threads, "дрель", "unread")).toHaveLength(0);
  });

  it("собеседник без имени поиску не мешает", () => {
    const anon = [thread({ counterpartName: null })];
    expect(filterThreads(anon, "дрель", "all")).toHaveLength(1);
    expect(filterThreads(anon, "иван", "all")).toHaveLength(0);
  });
});

/* Записи о сделке в ленте. Пока сторону выводили сравнением с отправителем,
 * пустой отправитель делал запись чужой: она вставала серым пузырём слева и
 * поднимала счётчик непрочитанного у обеих сторон. */
describe("buildFeed() и записи о сделке", () => {
  const now = new Date("2026-08-31T12:00:00");

  it("запись — свой элемент ленты, а не пузырь", () => {
    const feed = buildFeed([note("01A", 0)], { viewerId: ME, now });
    expect(feed.map((i) => i.kind)).toEqual(["date", "system"]);
  });

  it("запись разрывает группу, а не встраивается в неё", () => {
    const feed = buildFeed(
      [msg("01A", ME, 0), note("01B", 1), msg("01C", ME, 2)],
      { viewerId: ME, now },
    );
    expect(feed.map((i) => i.kind)).toEqual(["date", "group", "system", "group"]);
  });

  it("запись не считается непрочитанной ни одной из сторон", () => {
    for (const viewer of [ME, THEM]) {
      expect(unreadAnchor([note("01A", 0)], null, viewer)).toBeNull();
    }
  });

  it("в счёт непрочитанного записи не идут", () => {
    const messages = [note("01A", 0), msg("01B", THEM, 1)];
    const anchor = unreadAnchor(messages, null, ME);
    expect(anchor).toBe("01B");
    const feed = buildFeed(messages, { viewerId: ME, unreadAnchorId: anchor, now });
    const divider = feed.find((i) => i.kind === "unread");
    expect(divider?.kind === "unread" && divider.count).toBe(1);
  });
});
