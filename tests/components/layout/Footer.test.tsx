import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Footer } from "@/components/layout/Footer";
import { content } from "@theme/content";

describe("<Footer>", () => {
  it("содержит disclaimer и ссылку на /privacy", () => {
    const { container, getByText } = render(<Footer />);
    expect(container.textContent).toContain(content.footer.disclaimer);
    const link = getByText(content.footer.privacyLink) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/privacy");
  });

  it("атрибуция открытых данных: ссылка на условия OpenStreetMap и ГАР ФНС", () => {
    const { container, getByText } = render(<Footer />);
    const osm = getByText(content.footer.dataCredits.osm) as HTMLAnchorElement;
    expect(osm.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(container.textContent).toContain("ODbL");
    expect(container.textContent).toContain("ГАР ФНС России");
  });
});
