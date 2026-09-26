import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

// Цвета лежат в --color-* как чистый hex (IDE подсвечивает превью).
// Альфу подмешиваем через color-mix — Tailwind подставит <alpha-value> в момент сборки.
const c = (name: string) =>
  `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ["./src/**/*.{ts,tsx}", "./theme/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        background: c("--color-background"),
        foreground: c("--color-foreground"),
        header: {
          DEFAULT: c("--color-header"),
          foreground: c("--color-header-fg"),
          muted: c("--color-header-muted"),
        },
        primary: {
          DEFAULT:    c("--color-primary"),
          foreground: c("--color-primary-fg"),
        },
        accent: {
          DEFAULT:    c("--color-accent"),
          foreground: c("--color-accent-fg"),
        },
        // Главная кнопка и победитель вкладки — единственный оранжевый.
        cta: {
          DEFAULT:    c("--color-cta"),
          foreground: c("--color-cta-fg"),
          bright:     c("--color-cta-bright"),
          soft:       c("--color-cta-soft"),
        },
        "mark-dot": c("--color-mark-dot"),
        ok: {
          DEFAULT: c("--color-ok"),
          soft:    c("--color-ok-soft"),
        },
        warn: {
          DEFAULT: c("--color-warn"),
          soft:    c("--color-warn-soft"),
          line:    c("--color-warn-line"),
        },
        photo: c("--color-photo"),
        card: {
          DEFAULT:    c("--color-card"),
          foreground: c("--color-card-fg"),
        },
        muted: {
          DEFAULT:    c("--color-muted"),
          foreground: c("--color-muted-fg"),
        },
        border: {
          DEFAULT: c("--color-border"),
          strong:  c("--color-border-strong"),
        },
        ring:   c("--color-ring"),
        destructive: c("--color-danger"),
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        chip: "var(--radius-chip)",
        md: "var(--radius-md)",
        field: "var(--radius-field)",
        tabs: "var(--radius-tabs)",
        lg: "var(--radius-lg)",
        hero: "var(--radius-hero)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "var(--card-shadow)",
        "hero-search": "var(--hero-search-shadow)",
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-text)",
        // Знак и деньги.
        mark: "var(--font-mark)",
        // Служебные капсы.
        mono: "var(--font-mono)",
      },
      fontSize: {
        micro: "var(--text-micro)",
        "2xs": "var(--text-2xs)",
        xs:   "var(--text-xs)",
        sm:   "var(--text-sm)",
        base: "var(--text-base)",
        lg:   "var(--text-lg)",
        xl:   "var(--text-xl)",
        "2xl": "var(--text-2xl)",
        "3xl": "var(--text-3xl)",
      },
      lineHeight: {
        tight: "var(--leading-tight)",
        snug:  "var(--leading-snug)",
        body:  "var(--leading-body)",
      },
      letterSpacing: {
        display: "var(--tracking-display)",
        mark:    "var(--tracking-mark)",
        mono:    "var(--tracking-mono)",
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config;
