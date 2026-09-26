import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StepProgress } from "@/components/cabinet/StepProgress";

describe("StepProgress", () => {
  it("reports how many blocks are filled", () => {
    render(<StepProgress title="Сдаём вещь" done={2} total={4} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(screen.getByText(/2\s*из\s*4/)).toBeInTheDocument();
  });

  it("shows the title", () => {
    render(<StepProgress title="Правим объявление" done={0} total={4} />);
    expect(screen.getByText("Правим объявление")).toBeInTheDocument();
  });
});
