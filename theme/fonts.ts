import { Onest, Unbounded } from "next/font/google";

/* Unbounded — знак, заголовки H1/H2 и цены (итог в «билете», цены во вкладках
 * и карточках категорий). Вариативный: веса 500–700 без отдельных файлов. */
export const fontDisplay = Unbounded({
  subsets: ["cyrillic", "latin"],
  variable: "--font-display-var",
  display: "swap",
});

/* Onest — весь остальной текст интерфейса. */
export const fontText = Onest({
  subsets: ["cyrillic", "latin"],
  variable: "--font-text-var",
  display: "swap",
});
