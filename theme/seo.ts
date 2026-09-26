export const seo = {
  siteName: "inrenta",
  // Абсолютный заголовок: шаблон корневого layout («%s — inrenta») его не дописывает
  // второй раз. Для metadata.title страниц.
  titleTemplate: (pageTitle: string) => ({ absolute: `${pageTitle} — inrenta` }),
  defaultTitle: "inrenta — сравнение цен прокатов",
  defaultDescription:
    "Сравните цены прокатов своего города: итог за ваши даты, дорога до проката, залог и дата проверки каждой цены.",
  themeColor: "#ffffff",
  locale: "ru_RU",
  ogDefault: "/og-default.png",
} as const;
