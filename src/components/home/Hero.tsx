import Link from "next/link";
import { MapPin, CalendarDays } from "lucide-react";
import { content } from "@theme/content";
import { HeroSearch } from "./HeroSearch";

export interface HeroChip {
  slug: string;
  name: string;
}

export function Hero({
  citySlug,
  cityName,
  categories = [],
  search = true,
}: {
  citySlug?: string;
  cityName?: string;
  categories?: HeroChip[];
  /** Поиск по объявлениям — часть P2P-контура (FEATURE_P2P). */
  search?: boolean;
}) {
  const hasCategories = Boolean(citySlug) && categories.length > 0;
  return (
    // Отрицательный отступ на высоту хедера: блок уходит под плавающий хедер
    // до верхнего края экрана. Контент внутри опущен паддингом (см. photo/panel).
    <section className="w-full" style={{ marginTop: "calc(-1 * var(--header-h))" }}>
      <div className={hasCategories ? "grid lg:grid-cols-[2.45fr_1fr]" : "grid"}>
        {/* Фото-герой: прижат к краям экрана (флаш слева/сверху под хедером),
         * скруглён только нижний-правый угол. Картинка — public/hero.webp. */}
        <div className="hero-photo relative flex min-h-[610px] flex-col justify-center overflow-hidden rounded-br-[48px] px-6 pb-16 pt-[calc(var(--header-h)+2rem)] sm:px-10 lg:px-12">
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/40"
            aria-hidden="true"
          />
          <div className="relative mx-auto w-full max-w-4xl text-center">
            <h1 className="font-display text-4xl font-bold leading-[1.05] text-white sm:text-5xl lg:text-6xl">
              {content.home.heroTitle}
            </h1>
            <p className="mt-4 text-lg font-semibold text-white sm:text-xl">
              {content.home.heroSubtitle}
            </p>

            {search && (
              <div className="mt-8">
                <HeroSearch />
              </div>
            )}

            {citySlug && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-white">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Рядом · {cityName}
                  <Link href={`/${citySlug}` as never} className="text-accent hover:underline">
                    изменить
                  </Link>
                </span>
                <span className="inline-flex items-center gap-1.5 text-white/70">
                  <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Выбрать даты
                </span>
              </div>
            )}

            {hasCategories && (
              <div className="mt-6 text-left">
                <p className="mb-2 text-sm font-medium text-white/80">Популярное</p>
                <div className="flex flex-wrap gap-2">
                  {categories.slice(0, 5).map((c) => (
                    <Link
                      key={c.slug}
                      href={`/${citySlug}/${c.slug}` as never}
                      className="rounded-pill border border-white/25 bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur transition-colors hover:bg-white/20"
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Панель популярных категорий — прямо на фоне страницы, без карточки.
         * На десктопе верх опущен под хедер (стоит рядом с фото). */}
        {hasCategories && (
          <aside className="flex flex-col px-6 pb-2 pt-8 sm:px-8 lg:pb-10 lg:pt-[calc(var(--header-h)+1.5rem)]">
            <h2 className="mb-4 text-xl font-semibold text-foreground">
              {content.home.categoriesHeading}
            </h2>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/${citySlug}/${c.slug}` as never}
                  className="rounded-pill border border-primary/40 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/10"
                >
                  {c.name}
                </Link>
              ))}
            </div>
            <Link
              href={`/${citySlug}` as never}
              className="mt-5 inline-flex w-fit items-center rounded-pill border border-primary/40 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Все категории →
            </Link>
          </aside>
        )}
      </div>
    </section>
  );
}
