import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { Hero } from "@/components/home/Hero";
import { content } from "@theme/content";

describe("Hero", () => {
  it("shows the headline and a working search", () => {
    render(<Hero citySlug="kazan" categories={[{ slug: "instrument", name: "Инструмент" }]} />);
    expect(screen.getByText(content.home.heroTitle)).toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();
    // Категория рендерится и в быстрых чипах, и в панели — проверяем ссылку.
    expect(screen.getAllByRole("link", { name: "Инструмент" })[0]).toHaveAttribute(
      "href",
      "/kazan/instrument",
    );
  });

  it("omits category links when no city", () => {
    render(<Hero categories={[{ slug: "instrument", name: "Инструмент" }]} />);
    expect(screen.queryByRole("link", { name: "Инструмент" })).toBeNull();
  });
});

describe("Hero without listing search", () => {
  it("renders the headline only", () => {
    render(<Hero search={false} />);
    expect(screen.getByText(content.home.heroTitle)).toBeInTheDocument();
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("heading", { name: content.home.categoriesHeading })).toBeNull();
  });
});
