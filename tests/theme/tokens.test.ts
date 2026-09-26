import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { validateTokensCss } from "../../scripts/check-theme";

const css = readFileSync(join(process.cwd(), "theme", "tokens.css"), "utf8");

function block(sel: string): string {
  const re = new RegExp(`${sel.replace(/[.\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  return css.match(re)?.[1] ?? "";
}

describe("theme tokens", () => {
  it("keeps all required tokens present (check-theme contract)", () => {
    expect(validateTokensCss(css).ok).toBe(true);
  });

  // Вариант Б: бренд — тёмно-зелёный (шапка, вторичные кнопки), оранжевый —
  // только главная кнопка и победитель вкладки.
  it("uses the variant B brand and a single orange CTA", () => {
    expect(block(":root")).toMatch(/--color-primary:\s*#0F3D35/i);
    expect(block(":root")).toMatch(/--color-header:\s*#0F3D35/i);
    expect(block(":root")).toMatch(/--color-cta:\s*#C24A06/i);
    expect(block(".dark")).toMatch(/--color-cta:\s*#FF7A33/i);
  });

  it("defines the status colors in both themes", () => {
    for (const sel of [":root", ".dark"]) {
      for (const t of ["--color-ok", "--color-ok-soft", "--color-warn", "--color-warn-soft", "--color-cta-soft"]) {
        expect(block(sel)).toContain(`${t}:`);
      }
    }
  });
});
