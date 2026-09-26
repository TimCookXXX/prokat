export const seo = {
  siteName: "inrenta",
  titleTemplate: (pageTitle: string) => `${pageTitle} — inrenta`,
  defaultTitle: "inrenta — сравнение цен прокатов",
  defaultDescription:
    "Сравните цены прокатов своего города: итог за ваши даты с доставкой, залог и дата проверки каждой цены.",
  themeColor: "#ffffff",
  locale: "ru_RU",
  ogDefault: "/og-default.png",
} as const;
