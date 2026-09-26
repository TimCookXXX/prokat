import type { Metadata } from "next";
import NextTopLoader from "nextjs-toploader";
import { fontDisplay, fontText } from "@theme/fonts";
import { seo } from "@theme/seo";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";
import "./globals.css";
import "@theme/tokens.css";
import "@theme/typography.css";

export const metadata: Metadata = {
  title: { default: seo.defaultTitle, template: `%s — ${seo.siteName}` },
  description: seo.defaultDescription,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {

  return (
    <html
      lang="ru"
      suppressHydrationWarning
      className={`${fontDisplay.variable} ${fontText.variable}`}
    >
      <body className="bg-background text-foreground font-sans antialiased min-h-screen flex flex-col">
        {process.env.NODE_ENV === "production" && process.env.YANDEX_METRIKA_ID && (
          <YandexMetrika counterId={process.env.YANDEX_METRIKA_ID} />
        )}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {/* Глобальный progress-bar поверх <html>: даёт моментальный visual
           * feedback на любой client-side навигации (Link/router.push), пока
           * RSC грузит новую страницу. Цвет — токен --color-cta. */}
          <NextTopLoader color="var(--color-cta)" height={3} showSpinner={false} shadow={false} />
          <Header />
          <div className="flex-1">{children}</div>
          {/* Отступ под парящий таб-бар: на десктопе --tabbar-h равна нулю. */}
          <div className="pb-[var(--tabbar-h)]">
            <Footer />
          </div>
          <MobileNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
