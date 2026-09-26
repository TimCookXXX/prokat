# Theme tokens contract

В [theme/tokens.css](tokens.css) ОБЯЗАТЕЛЬНО должны быть определены следующие CSS-переменные внутри блоков `:root` (light) и `.dark` (dark).

## Цвета (hex)
- --color-background
- --color-foreground
- --color-header
- --color-card
- --color-card-fg
- --color-primary
- --color-primary-fg
- --color-accent
- --color-muted
- --color-muted-fg
- --color-border
- --color-ring
- --color-danger
- --color-header-fg, --color-header-muted (текст на шапке)
- --color-cta, --color-cta-fg (главная кнопка, победитель вкладки), --color-cta-bright (декор на тёмном), --color-cta-soft (подсказка)
- --color-mark-dot (точка знака на светлом)
- --color-ok, --color-ok-soft, --color-warn, --color-warn-soft, --color-warn-line (статусы)
- --color-border-strong, --color-photo

## Радиусы
- --radius-sm
- --radius-md
- --radius-lg
- --radius-pill (для пилюль/кружочков — `9999px`)

## Шрифты (имена next/font CSS-переменных или font-family)
- --font-display
- --font-text
- --font-mark (знак и деньги: цена, залог, итог)
- --font-mono (служебные капсы 10–11 px)

## Принципы значений
- Цвета: hex (`#RRGGBB`), например `#2970FF`. IDE подсвечивает превью.
- Альфа: применяется через `color-mix(...)` в [tailwind.config.ts](../tailwind.config.ts) — в самих токенах прозрачность не задаём. Утилиты вида `bg-primary/50` работают.
- Радиусы: целое значение с `px`, например `10px`. `--radius-pill: 9999px` — для пилюли.
- Шрифты: `var(--font-...)` от next/font.
