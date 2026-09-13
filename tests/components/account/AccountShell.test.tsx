import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Путь задаётся из теста: хаб и кнопка «назад» зависят от того, где стоишь.
const nav = vi.hoisted(() => ({ pathname: "/requests", back: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn(), back: nav.back, push: nav.push }),
}));

// Кнопки смены обложки и аватарки тянут server actions, а те — весь стек auth:
// под jsdom он не собирается, да и тестируем здесь разметку каркаса, а не
// сохранение. updateAvatar в моке держится про запас: сегодня тесты до него не
// доходят (тело окна рисуется только открытым), и его отсутствие ничего не
// ломает — но тест, который откроет окно, упал бы на undefined.
vi.mock("@/server/actions/profile", () => ({ updateCover: vi.fn(), updateAvatar: vi.fn() }));

import { AccountShell } from "@/components/account/AccountShell";
import { RealtimeContext } from "@/components/realtime/context";
import { createRealtimeStore } from "@/components/realtime/store";

const groups = [
  { title: "я арендую", items: [{ href: "/requests", label: "Мои заявки" }] },
  { title: "мои вещи", items: [{ href: "/cabinet/listings", label: "Мои объявления" }] },
];

const identity = {
  name: "Марина",
  email: "marina@ya.ru",
  image: null,
  coverUrl: null,
  isVerified: true,
  activeListings: 3,
  deals: 12,
  upcomingBookings: 2,
  pendingMine: 1,
};

describe("AccountShell", () => {
  it("shows group titles above their sections", () => {
    nav.pathname = "/requests";
    render(<AccountShell groups={groups}>x</AccountShell>);
    expect(screen.getByText("я арендую")).toBeInTheDocument();
    expect(screen.getByText("мои вещи")).toBeInTheDocument();
  });

  it("titles the page with the section you are standing in", () => {
    nav.pathname = "/requests";
    render(<AccountShell groups={groups}>x</AccountShell>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Мои заявки");
  });

  it("puts the person and their counts into the hero, not the sidebar", () => {
    nav.pathname = "/requests";
    render(<AccountShell groups={groups} identity={identity}>x</AccountShell>);
    expect(screen.getByText("Марина")).toBeInTheDocument();
    expect(screen.getByText("marina@ya.ru")).toBeInTheDocument();
    expect(screen.getByText("объявления")).toBeInTheDocument();
    expect(screen.getByText("аренд")).toBeInTheDocument();
    expect(screen.getByText("Проверен")).toBeInTheDocument();
  });

  it("falls back to the default preset cover until the person picks one", () => {
    nav.pathname = "/requests";
    const { container } = render(
      <AccountShell groups={groups} identity={identity}>x</AccountShell>,
    );
    const cover = container.querySelector("img[src='/covers/lenta.svg']");
    expect(cover).not.toBeNull();
  });

  it("shows the mobile hub only on the cabinet summary", () => {
    nav.pathname = "/cabinet";
    render(
      <AccountShell
        groups={[{ title: "сейчас", items: [{ href: "/cabinet", label: "Сводка", exact: true }] }, ...groups]}
        identity={identity}
      >
        x
      </AccountShell>,
    );
    // Хаб дублирует навигацию строками: «Мои заявки» есть в сайдбаре и в хабе.
    expect(screen.getAllByRole("link", { name: /Мои заявки/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Назад" })).toBeNull();
  });

  it("offers a history-back button in a subsection", () => {
    nav.pathname = "/requests";
    render(<AccountShell groups={groups} identity={identity}>x</AccountShell>);
    expect(screen.getByRole("button", { name: "Назад" })).toBeInTheDocument();
  });

  it("offers a way out in the sidebar and in the hub", () => {
    nav.pathname = "/cabinet";
    render(
      <AccountShell
        groups={[{ title: "сейчас", items: [{ href: "/cabinet", label: "Сводка", exact: true }] }, ...groups]}
        identity={identity}
      >
        x
      </AccountShell>,
    );
    expect(screen.getAllByRole("button", { name: /Выйти/ })).toHaveLength(2);
  });

  it("keeps the plain layout when there is nobody to show", () => {
    nav.pathname = "/requests";
    render(<AccountShell groups={groups}>x</AccountShell>);
    expect(screen.queryByText("Проверен")).toBeNull();
    expect(screen.queryByRole("button", { name: "Назад" })).toBeNull();
  });
});

// Правило «стор ?? проп». Оно новое и самое хрупкое из клиентских: при живом
// соединении число берётся из стора, при потерянном — снова из серверного
// пропа. Без возврата к пропу умерший realtime заморозил бы бейдж навсегда.
describe("AccountShell: живой счётчик", () => {
  const withChat = [{
    title: "сейчас",
    items: [{ href: "/chat", label: "Сообщения", badge: 2, icon: "messages" as const }],
  }];

  const renderWith = (store: ReturnType<typeof createRealtimeStore>) => render(
    <RealtimeContext.Provider value={store}>
      <AccountShell groups={withChat} identity={identity}>x</AccountShell>
    </RealtimeContext.Provider>,
  );

  it("пока стор пуст, показывает серверное число", () => {
    renderWith(createRealtimeStore());
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("со стором показывает его число, а не серверное", () => {
    const store = createRealtimeStore();
    store.getState().setCounters({ messages: 9, incoming: 0, mine: 0 });
    renderWith(store);
    expect(screen.getAllByText("9").length).toBeGreaterThan(0);
    expect(screen.queryByText("2")).toBeNull();
  });

  it("после потери соединения возвращается к серверному числу", () => {
    const store = createRealtimeStore();
    store.getState().setCounters({ messages: 9, incoming: 0, mine: 0 });
    store.getState().forgetCounters();
    renderWith(store);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.queryByText("9")).toBeNull();
  });
});

