// Tailwind-пресет на тех же CSS-переменных, что и design/tokens.css.
// Tailwind v3: presets: [require("./docs/inrenta-pivot/design/tailwind.preset")] в tailwind.config.
// Tailwind v4: те же значения перенести в @theme в globals.css (имена цветов — как ниже).
import type { Config } from "tailwindcss";

const preset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        ground: "var(--c-ground)",
        surface: "var(--c-surface)",
        brand: { DEFAULT: "var(--c-brand)", text: "var(--c-brand-text)" },
        ink: "var(--c-ink)",
        muted: "var(--c-muted)",
        line: { DEFAULT: "var(--c-line)", strong: "var(--c-line-strong)" },
        accent: {
          DEFAULT: "var(--c-accent)",
          on: "var(--c-accent-on)",
          bright: "var(--c-accent-bright)",
          soft: "var(--c-accent-soft)",
        },
        ok: { DEFAULT: "var(--c-ok)", soft: "var(--c-ok-soft)" },
        warn: { DEFAULT: "var(--c-warn)", soft: "var(--c-warn-soft)", line: "var(--c-warn-line)" },
        photo: "var(--c-photo)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        text: ["var(--font-text)"],
      },
      borderRadius: {
        badge: "var(--r-badge)",
        chip: "var(--r-chip)",
        button: "var(--r-button)",
        field: "var(--r-field)",
        tabs: "var(--r-tabs)",
        card: "var(--r-card)",
        "hero-search": "var(--r-hero-search)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "hero-search": "var(--shadow-hero-search)",
      },
      spacing: {
        gutter: "var(--page-gutter)",
        filters: "var(--filters-width)",
        "ticket-left": "var(--ticket-left)",
      },
    },
  },
};

export default preset;
