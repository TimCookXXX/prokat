import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// jsdom не применяет Tailwind, поэтому «видимость» колонок проверяется по
// мобильному классу hidden на обёртке, а не через toBeVisible().

let segment: string | null = null;

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => segment,
}));

const { ChatPanes } = await import("@/components/chat/ChatPanes");

const panes = (hasThreads = true) =>
  render(
    <ChatPanes list={<span data-testid="list" />} hasThreads={hasThreads}>
      <span data-testid="child" />
    </ChatPanes>,
  );

const wrapperOf = (testId: string) => screen.getByTestId(testId).parentElement!;

beforeEach(() => {
  segment = null;
});

describe("ChatPanes", () => {
  it("на /chat показывает список, диалог скрыт", () => {
    panes();
    expect(wrapperOf("list").classList.contains("hidden")).toBe(false);
    expect(wrapperOf("child").classList.contains("hidden")).toBe(true);
  });

  it("с открытым тредом показывает диалог, список скрыт", () => {
    segment = "01A";
    panes();
    expect(wrapperOf("list").classList.contains("hidden")).toBe(true);
    expect(wrapperOf("child").classList.contains("hidden")).toBe(false);
  });

  it("композер /chat/new — такой же открытый диалог", () => {
    segment = "new";
    panes();
    expect(wrapperOf("list").classList.contains("hidden")).toBe(true);
    expect(wrapperOf("child").classList.contains("hidden")).toBe(false);
  });

  // Без переписок список колонкой не занимает места — иначе на десктопе выходят
  // две заглушки рядом, обе про одно и то же.
  it("без переписок рендерит только содержимое, без колонки списка", () => {
    panes(false);
    expect(screen.queryByTestId("list")).toBeNull();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
