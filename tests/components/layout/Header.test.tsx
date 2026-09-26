import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
// Header renders HeaderSearch, which calls useRouter() at render — must be mocked
// or jsdom throws "invariant expected app router to be mounted".
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// City row is untyped in the mock: only slug/name are read; no need to satisfy the
// full City type (real rows have more columns).
vi.mock("@/server/catalog", () => ({
  getActiveCities: vi.fn(async () => [{ id: "1", slug: "krasnodar", name: "Краснодар" }]),
}));
const p2p = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/features", () => ({ isP2PEnabled: () => p2p.on }));

import { Header } from "@/components/layout/Header";

describe("Header", () => {
  it("shows the brand, the only city, service links and login", async () => {
    p2p.on = false;
    render(await Header());
    expect(screen.getByRole("link", { name: "inrenta" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Краснодар")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Как считаем цены" })).toHaveAttribute("href", "/kak-schitaem-ceny");
    expect(screen.getByRole("link", { name: "Для прокатов" })).toHaveAttribute("href", "/dlya-prokatov");
    expect(screen.getByRole("link", { name: /Войти/ })).toBeInTheDocument();
  });

  it("hides listing search and place CTA without the P2P flow", async () => {
    p2p.on = false;
    render(await Header());
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("link", { name: /Разместить/ })).toBeNull();
  });

  it("adds listing search and place CTA with the P2P flow", async () => {
    p2p.on = true;
    render(await Header());
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Разместить/ })).toBeInTheDocument();
  });
});
