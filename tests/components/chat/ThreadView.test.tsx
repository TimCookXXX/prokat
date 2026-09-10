import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSelectedLayoutSegment: () => null,
}));

vi.mock("@/server/actions/chat", () => ({
  markThreadRead: vi.fn(async () => ({ ok: true, data: undefined })),
  fetchOlderMessages: vi.fn(),
  postMessage: vi.fn(),
  startThread: vi.fn(),
}));

// Догон дельты и обновление счётчиков. Мок обязателен: цепочка auth() →
// next-auth → next/server в jsdom не разрешается.
const realtime = vi.hoisted(() => ({
  fetchNewerMessages: vi.fn(async () => ({ ok: true, data: { messages: [], hasMore: false } })),
  fetchRealtimeUpdate: vi.fn(async () => ({
    ok: true,
    data: { counters: { messages: 0, incoming: 0, mine: 0 }, toast: null },
  })),
}));
vi.mock("@/server/actions/realtime", () => realtime);

const { ThreadView } = await import("@/components/chat/ThreadView");
const { content } = await import("@theme/content");

const message = (id: string, sender: string, body: string) => ({
  id, senderUserId: sender, kind: "user" as const, body, meta: null,
  createdAt: new Date("2026-08-31T10:00:00Z"),
});

const base = {
  mode: { kind: "thread", threadId: "01T" } as const,
  viewerId: "01ME",
  initialMessages: [message("01A", "01THEM", "здравствуйте")],
  initialHasMore: false,
};

describe("ThreadView", () => {
  it("даёт написать, когда переписка открыта", () => {
    render(<ThreadView {...base} />);
    expect(screen.getByLabelText("Текст сообщения")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить" })).toBeInTheDocument();
  });

  // Композер должен исчезать целиком, а не просто отклонять отправку: правило
  // «читать можно всегда, писать — нет» обязано быть видно на экране.
  it("прячет композер и объясняет причину, когда писать нельзя", () => {
    render(<ThreadView {...base} blockedReason="Объявление снято с публикации." />);
    expect(screen.queryByLabelText("Текст сообщения")).toBeNull();
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
    expect(screen.getByText("Объявление снято с публикации.")).toBeInTheDocument();
  });

  it("показывает историю и не теряет её при блокировке", () => {
    render(<ThreadView {...base} blockedReason="Аккаунт собеседника заблокирован." />);
    expect(screen.getByText("здравствуйте")).toBeInTheDocument();
  });

  it("без ранней истории кнопки подгрузки нет", () => {
    render(<ThreadView {...base} />);
    expect(screen.queryByRole("button", { name: /более ранние/ })).toBeNull();
  });

  it("с ранней историей кнопка подгрузки есть", () => {
    render(<ThreadView {...base} initialHasMore />);
    expect(screen.getByRole("button", { name: /более ранние/ })).toBeInTheDocument();
  });

  // initialMessages только засевают состояние. Значит при переходе между
  // переписками компонент обязан монтироваться заново — иначе в новой
  // переписке останется лента предыдущей. За это отвечает key={threadId}
  // на странице треда; здесь фиксируем сам факт, что состояние не следует
  // за пропами.
  it("не подхватывает новые initialMessages без пересоздания", () => {
    const { rerender } = render(<ThreadView {...base} />);
    rerender(
      <ThreadView
        {...base}
        mode={{ kind: "thread", threadId: "01OTHER" }}
        initialMessages={[message("01B", "01THEM", "другая переписка")]}
      />,
    );
    expect(screen.queryByText("другая переписка")).toBeNull();
    expect(screen.getByText("здравствуйте")).toBeInTheDocument();
  });
});

// Индикатор сделан заранее под задачу о вебсокетах и до неё всегда выключен.
// Тест держит проп живым: без него компонент к тому моменту разойдётся с
// реальностью, и tsc этого не поймает.
describe("ThreadView: заготовка под реальное время", () => {
  it("по умолчанию «печатает…» не показывает", () => {
    render(<ThreadView {...base} counterpartName="Иван" />);
    expect(screen.queryByText(/печатает/)).toBeNull();
  });

  it("с typing показывает индикатор и называет собеседника", () => {
    render(<ThreadView {...base} typing counterpartName="Иван" />);
    expect(screen.getByText(`Иван ${content.chat.typing}`)).toBeInTheDocument();
  });
});

// Баг, найденный руками: прочитал переписку — счётчик в сайдбаре и кружок в
// шапке оставались до перезагрузки. При живом сокете они читают стор, а
// markThreadRead писал только в базу и звал router.refresh(), который обновляет
// серверный проп — то есть ровно то, что в этот момент не используется.
describe("ThreadView: прочтение гасит счётчики", () => {
  it("после markThreadRead перечитывает счётчики", async () => {
    realtime.fetchRealtimeUpdate.mockClear();
    render(
      <ThreadView
        mode={{ kind: "thread", threadId: "t1" }}
        viewerId="me"
        initialMessages={[message("m1", "other", "привет")]}
        initialHasMore={false}
      />,
    );
    await waitFor(() => expect(realtime.fetchRealtimeUpdate).toHaveBeenCalled());
  });
});

// Найдено на мобиле при обрыве LTE: пузырь навсегда завис в «отправляется…».
// Server Action при сетевом сбое не возвращает {ok:false}, а бросает — без
// перехвата промис отклонялся молча, а текст пропадал вместе с пузырём.
describe("ThreadView: обрыв связи при отправке", () => {
  it("не оставляет сообщение висеть и возвращает текст в поле", async () => {
    const chat = await import("@/server/actions/chat");
    vi.mocked(chat.postMessage).mockRejectedValueOnce(new Error("Failed to fetch"));

    render(<ThreadView {...base} />);
    const input = screen.getByLabelText(content.chat.composerLabel);
    fireEvent.change(input, { target: { value: "не доехало" } });
    fireEvent.click(screen.getByRole("button", { name: content.chat.send }));

    await waitFor(() => {
      expect(screen.queryByText(content.chat.sending)).toBeNull();
    });
    // Текст возвращается в поле: иначе он потерян безвозвратно.
    expect(screen.getByLabelText(content.chat.composerLabel)).toHaveValue("не доехало");
    expect(screen.getByText(/Нет связи/)).toBeInTheDocument();
  });
});

// Галочки прочтения теперь приезжают событием, а не ждут перезагрузки: курсор
// собеседника переехал из пропа в состояние.
describe("ThreadView: галочки в реальном времени", () => {
  it("курсор собеседника двигается только вперёд", async () => {
    const { createRealtimeStore } = await import("@/components/realtime/store");
    const { RealtimeContext } = await import("@/components/realtime/context");
    const store = createRealtimeStore();

    const { rerender } = render(
      <RealtimeContext.Provider value={store}>
        <ThreadView {...base} counterpartCursor="01B" />
      </RealtimeContext.Provider>,
    );

    // Опоздавшее событие с более старой отметкой не должно снимать галочки.
    await act(async () => { store.getState().pushRead("01T", "01A"); });
    rerender(
      <RealtimeContext.Provider value={store}>
        <ThreadView {...base} counterpartCursor="01B" />
      </RealtimeContext.Provider>,
    );
    expect(store.getState().lastRead).toEqual({ threadId: "01T", upToId: "01A" });
  });
});

// Прокрутка вниз при отправке — ровно тот сценарий, который был сломан.
// jsdom раскладки не считает: scrollHeight и clientHeight там всегда нули,
// поэтому геометрия подменяется руками. Без подмены тест зелёный на заведомо
// сломанном коде — так первая версия этой проверки и прошла впустую.
describe("ThreadView: лента держится низа", () => {
  const geometry = (el: Element, scrollHeight: number, clientHeight: number) => {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  };

  it("после отправки уезжает в самый низ", async () => {
    const chat = await import("@/server/actions/chat");
    vi.mocked(chat.postMessage).mockResolvedValueOnce({
      ok: true,
      data: { message: message("01Z", "01ME", "моё новое") },
    } as never);

    render(<ThreadView {...base} />);
    const feed = screen.getByLabelText("Сообщения");
    geometry(feed, 1000, 400);
    feed.scrollTop = 0;

    fireEvent.change(screen.getByLabelText(content.chat.composerLabel), {
      target: { value: "моё новое" },
    });
    fireEvent.click(screen.getByRole("button", { name: content.chat.send }));

    // Лента обязана доехать до конца. На сломанной версии замер выполнялся уже
    // после вставки, решал «человек далеко от низа» и прокрутку отменял.
    await waitFor(() => expect(feed.scrollTop).toBe(1000));
  });

  // Ровно тот сценарий, который был сломан: человек ушёл читать середину
  // переписки и написал сообщение. Правило «не дёргать читающего» относится
  // только к ЧУЖИМ сообщениям — своё он сам только что отправил.
  it("прокручивает вниз, даже когда человек ушёл наверх", async () => {
    const chat = await import("@/server/actions/chat");
    vi.mocked(chat.postMessage).mockResolvedValueOnce({
      ok: true,
      data: { message: message("01Y", "01ME", "ещё одно") },
    } as never);

    render(<ThreadView {...base} />);
    const feed = screen.getByLabelText("Сообщения");
    geometry(feed, 2000, 400);
    feed.scrollTop = 100;
    fireEvent.scroll(feed);          // ушёл читать середину

    fireEvent.change(screen.getByLabelText(content.chat.composerLabel), {
      target: { value: "ещё одно" },
    });
    fireEvent.click(screen.getByRole("button", { name: content.chat.send }));

    await waitFor(() => expect(feed.scrollTop).toBe(2000));
  });

  // А догрузка ранней истории дописывает СВЕРХУ — прыжок вниз выбросил бы
  // человека из того, что он читает.
  it("догрузка ранней истории вниз не прыгает", async () => {
    const chat = await import("@/server/actions/chat");
    let release: (v: unknown) => void = () => {};
    vi.mocked(chat.fetchOlderMessages).mockReturnValueOnce(
      new Promise((r) => { release = r; }) as never,
    );

    render(<ThreadView {...base} initialHasMore />);
    const feed = screen.getByLabelText("Сообщения");
    geometry(feed, 2000, 400);
    feed.scrollTop = 100;
    fireEvent.scroll(feed);

    fireEvent.click(screen.getByRole("button", { name: /более ранние/ }));
    await act(async () => {
      release({ ok: true, data: { messages: [message("01OLD", "01THEM", "старое")], hasMore: false } });
    });

    await waitFor(() => expect(screen.getByText("старое")).toBeInTheDocument());
    expect(feed.scrollTop).toBe(100);
  });
});

// Чужое сообщение не утаскивает читающего вниз — но и молчать нельзя, иначе он
// узнает о нём, только докрутив сам.
describe("ThreadView: кнопка «новые сообщения»", () => {
  const geo = (el: Element, sh: number, ch: number) => {
    Object.defineProperty(el, "scrollHeight", { value: sh, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: ch, configurable: true });
  };

  const withStore = async () => {
    const { createRealtimeStore } = await import("@/components/realtime/store");
    const { RealtimeContext } = await import("@/components/realtime/context");
    return { store: createRealtimeStore(), RealtimeContext };
  };

  it("появляется, когда чужое пришло, а человек читает старое", async () => {
    const realtimeMod = await import("@/server/actions/realtime");
    vi.mocked(realtimeMod.fetchNewerMessages).mockResolvedValueOnce({
      ok: true,
      data: { messages: [message("01NEW", "01THEM", "пока ты читал")], hasMore: false },
    } as never);

    const { store, RealtimeContext } = await withStore();
    render(
      <RealtimeContext.Provider value={store}>
        <ThreadView {...base} />
      </RealtimeContext.Provider>,
    );
    const feed = screen.getByLabelText("Сообщения");
    geo(feed, 2000, 400);
    feed.scrollTop = 100;
    fireEvent.scroll(feed);                       // ушёл читать старое

    await act(async () => { store.getState().pushMessage("01T", "01NEW"); });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Новые сообщения/ })).toBeInTheDocument();
    });
    // Ленту при этом не дёрнуло.
    expect(feed.scrollTop).toBe(100);
  });

  it("по нажатию везёт вниз и исчезает", async () => {
    const realtimeMod = await import("@/server/actions/realtime");
    vi.mocked(realtimeMod.fetchNewerMessages).mockResolvedValueOnce({
      ok: true,
      data: { messages: [message("01NEW2", "01THEM", "ещё")], hasMore: false },
    } as never);

    const { store, RealtimeContext } = await withStore();
    render(
      <RealtimeContext.Provider value={store}>
        <ThreadView {...base} />
      </RealtimeContext.Provider>,
    );
    const feed = screen.getByLabelText("Сообщения");
    geo(feed, 2000, 400);
    feed.scrollTop = 100;
    fireEvent.scroll(feed);
    await act(async () => { store.getState().pushMessage("01T", "01NEW2"); });

    const button = await screen.findByRole("button", { name: /Новые сообщения/ });
    fireEvent.click(button);

    expect(feed.scrollTop).toBe(2000);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Новые сообщения/ })).toBeNull();
    });
  });

  it("не появляется, когда человек и так внизу", async () => {
    const realtimeMod = await import("@/server/actions/realtime");
    vi.mocked(realtimeMod.fetchNewerMessages).mockResolvedValueOnce({
      ok: true,
      data: { messages: [message("01NEW3", "01THEM", "внизу")], hasMore: false },
    } as never);

    const { store, RealtimeContext } = await withStore();
    render(
      <RealtimeContext.Provider value={store}>
        <ThreadView {...base} />
      </RealtimeContext.Provider>,
    );
    const feed = screen.getByLabelText("Сообщения");
    geo(feed, 2000, 400);
    feed.scrollTop = 1600;                        // у самого низа
    fireEvent.scroll(feed);
    await act(async () => { store.getState().pushMessage("01T", "01NEW3"); });

    await waitFor(() => expect(screen.getByText("внизу")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Новые сообщения/ })).toBeNull();
  });
});

// Пузырь в полёте обязан занимать столько же места, сколько отправленный.
// Слово «отправляется…» шире, чем «23:28 ✓», и на коротких сообщениях пузырь
// схлопывался на глазах — текст переливался.
describe("ThreadView: пузырь в полёте", () => {
  it("показывает время и часы, а не слово", async () => {
    const chat = await import("@/server/actions/chat");
    let release: (v: unknown) => void = () => {};
    vi.mocked(chat.postMessage).mockReturnValueOnce(
      new Promise((r) => { release = r; }) as never,
    );

    render(<ThreadView {...base} />);
    fireEvent.change(screen.getByLabelText(content.chat.composerLabel), {
      target: { value: "ок" },
    });
    fireEvent.click(screen.getByRole("button", { name: content.chat.send }));

    // Слова быть не должно нигде, кроме озвучки для скринридера.
    await waitFor(() => expect(screen.getByText("ок")).toBeInTheDocument());
    const bubble = screen.getByText("ок").closest("div")!;
    expect(bubble.textContent).toMatch(/\d{2}:\d{2}/);
    expect(bubble.querySelector(".sr-only")?.textContent).toBe(content.chat.sending);

    await act(async () => {
      release({ ok: true, data: { message: message("01S", "01ME", "ок") } });
    });
    // После подтверждения — то же время на месте, меняется только иконка.
    await waitFor(() => {
      expect(screen.getByText("ок").closest("div")!.textContent).toMatch(/\d{2}:\d{2}/);
    });
  });
});
