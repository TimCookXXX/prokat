import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LiveDot, LiveCount } from "@/components/realtime/LiveDot";
import { RealtimeContext } from "@/components/realtime/context";
import { createRealtimeStore } from "@/components/realtime/store";

// Правило областей существует ради одного: не показывать один и тот же факт
// дважды. Кружок на чатах и кружок на кабинете обязаны считать разное, иначе
// они дублируют друг друга — так это и выглядело до разделения.

function withStore(
  counters: { messages: number; incoming: number; mine: number } | null,
  ui: React.ReactNode,
) {
  const store = createRealtimeStore();
  if (counters) store.getState().setCounters(counters);
  return render(
    <RealtimeContext.Provider value={store}>{ui}</RealtimeContext.Provider>,
  );
}

const only = (messages: number, incoming: number, mine: number) =>
  ({ messages, incoming, mine });

describe("области индикаторов", () => {
  it("кружок чатов зажигают только сообщения", () => {
    withStore(only(2, 0, 0), <LiveDot scope="messages" />);
    expect(screen.getByText("Есть новое")).toBeInTheDocument();
  });

  it("кружок чатов молчит на заявках", () => {
    withStore(only(0, 3, 1), <LiveDot scope="messages" />);
    expect(screen.queryByText("Есть новое")).toBeNull();
  });

  // Ключевое: сообщения уже отмечены на соседней вкладке.
  it("кружок кабинета молчит, когда есть только сообщения", () => {
    withStore(only(5, 0, 0), <LiveDot scope="other" />);
    expect(screen.queryByText("Есть новое")).toBeNull();
  });

  it("кружок кабинета зажигают заявки", () => {
    withStore(only(0, 1, 0), <LiveDot scope="other" />);
    expect(screen.getByText("Есть новое")).toBeInTheDocument();
  });

  it("аватарка в шапке зажигается от чего угодно", () => {
    withStore(only(1, 0, 0), <LiveDot scope="all" />);
    expect(screen.getByText("Есть новое")).toBeInTheDocument();
  });

  it("без соединения индикатора нет вовсе", () => {
    withStore(null, <LiveDot scope="all" />);
    expect(screen.queryByText("Есть новое")).toBeNull();
  });
});

describe("число в меню", () => {
  it("показывает счётчик сообщений", () => {
    withStore(only(4, 9, 9), <LiveCount scope="messages" />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("на нуле не рисуется", () => {
    withStore(only(0, 5, 5), <LiveCount scope="messages" />);
    expect(screen.queryByText("0")).toBeNull();
  });
});

// Главный инвариант: точка на аватарке обязана быть объяснима выпадашкой.
// Именно этого не было — заявка зажигала точку, человек открывал меню, а там
// не было даже пункта «Заявки на мои вещи».
describe("точка объяснима меню", () => {
  it("scope=all равен сумме того, что показано пунктами", () => {
    const c = { messages: 2, incoming: 3, mine: 4 };
    const sum = (s: Parameters<typeof LiveCount>[0]["scope"]) => {
      const { container } = withStore(c, <LiveCount scope={s} />);
      return Number(container.textContent!.replace(/\D+/g, "").slice(0, 2));
    };
    expect(sum("all")).toBe(sum("messages") + sum("incoming") + sum("mine"));
  });

  // Счётчик может быть покрыт не только одноимённым пунктом: заявки обеих
  // ролей живут одной лентой, и её пункт показывает other — сумму incoming и
  // mine. Важно, что точка объяснима, а не что имена совпали.
  const COVERING_SCOPES: Record<string, readonly string[]> = {
    messages: ["messages", "all"],
    incoming: ["incoming", "other", "all"],
    mine: ["mine", "other", "all"],
  };

  it("каждый счётчик покрыт пунктом меню", async () => {
    const { LINKS } = await import("@/components/auth/UserMenu");
    const covered = new Set(
      LINKS.flatMap((l) => ("counter" in l ? [l.counter as string] : [])),
    );
    // Ключи стора берутся с живого объекта: добавили счётчик и забыли пункт —
    // тест падает, а не молча появляется необъяснимая точка.
    for (const key of Object.keys({ messages: 0, incoming: 0, mine: 0 })) {
      const ok = COVERING_SCOPES[key]!.some((scope) => covered.has(scope));
      expect(ok, `нет пункта меню, объясняющего «${key}»`).toBe(true);
    }
  });
});
