import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { City } from "@/server/catalog";
import { getSearchData } from "@/server/compare";
import { suggestEnabled } from "@/server/geocoder";
import { addDaysStr } from "@/lib/catalog/dates";
import { STALE_AFTER_DAYS, formatRub, isStale } from "@/lib/compare/pricing";
import {
  activeFilterCount, localToday, parseResultParams, patchParams, resultHref, targetHref, type ParamsPatch, type ResultParams,
} from "@/lib/compare/scenario";
import { buildResultView, type CompareOffer } from "@/lib/compare/view";
import { cityNow, openLabel, openState } from "@/lib/compare/hours";
import {
  locationLabel, nearestMicrodistrict, okrugName, userOkrug, type CityGeo,
} from "@/lib/compare/geo";
import type { Chip, SearchTarget } from "@/lib/compare/search";
import { buildFaq } from "@/lib/compare/faq";
import { dateRangeLabel, daysLabel, shopsLabel } from "@/lib/compare/format";
import { buildBreadcrumbJsonLd, buildFaqJsonLd } from "@/lib/jsonld";
import { siteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/seo/JsonLd";
import { SearchBar } from "./SearchBar";
import { ClassSwitch } from "./ClassSwitch";
import { ResultTabs } from "./ResultTabs";
import { FiltersPanel, FiltersSheet } from "./FiltersPanel";
import { SavingsHint } from "./SavingsHint";
import { OfferTicket } from "./OfferTicket";
import { OutOfRanking } from "./OutOfRanking";
import { RegularRequestForm } from "./RegularRequestForm";
import { NotFoundRequestForm } from "./NotFoundRequestForm";
import { CompareFaq } from "./CompareFaq";

type RawParams = Record<string, string | string[] | undefined>;

/** Что показывает страница выдачи: группа, модель или результат поиска. */
export interface ResultScope {
  /** Путь страницы — к нему дописываются параметры. */
  path: string;
  /** H1. */
  title: string;
  crumbs: { label: string; href?: string }[];
  /** «Перфоратор», «Karcher Puzzi 8/1 C» — для сводки и форм заявок. */
  what: string;
  /** Группа — для пиктограмм вместо фото. */
  iconGroup: string;
  /** Классы группы (больше одного) — чипы «Все / SDS-plus / SDS-max». */
  classes?: { id: string; slug: string; name: string; shortHint: string | null }[];
  /** Класс страницы модели — для учёта заявок «нужен регулярно». */
  itemClassId?: string;
  /** Фильтр по модели на странице (на странице модели не нужен). */
  showModels: boolean;
  guide?: string | null;
  /** «Прокат перфоратора» — FAQ для SEO-страниц группы и модели. */
  faqTitle?: string | null;
  /** Цель поиска, которой соответствует страница — текст и выбор в строке поиска. */
  searchTarget: SearchTarget | null;
  /** Неоднозначный запрос: чипы уточнения над выдачей. */
  chips?: Chip[];
  /** Пустая выдача: похожее и форма «найдём за 30 минут». */
  similar?: { label: string; href: string }[];
}

/** Сводка о месте пользователя: «Юбилейный ≈», «ул. Северная, 15 · Западный округ, Юбилейный». */
function whereText(p: ResultParams, geo: CityGeo, cityName: string): string {
  if (p.loc.kind !== "point") return p.loc.kind === "city" ? `${cityName}, весь город` : locationLabel(p.loc, geo, cityName);
  const okrug = okrugName(userOkrug(p.loc, geo), geo);
  const micro = nearestMicrodistrict(p.loc.point, geo)?.name;
  return [locationLabel(p.loc, geo, cityName), [okrug, micro].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}

// Страница выдачи (ТЗ, раздел 5): итог за даты у каждого проката, расстояние и
// время в пути, вкладки, фильтры, «билеты». Всё считается на сервере по
// параметрам из URL — ссылка открывает ту же выдачу в том же порядке.
export async function ResultPage({
  city, geo, scope, offers, searchParams,
}: {
  city: City;
  geo: CityGeo;
  scope: ResultScope;
  /** Все предложения страницы; класс и бренд из URL сужают их здесь. */
  offers: CompareOffer[];
  searchParams: RawParams;
}) {
  const today = localToday();
  const now = cityNow();
  const p = parseResultParams(searchParams, today, geo);
  const search = await getSearchData(city.id, addDaysStr(today, -STALE_AFTER_DAYS));
  const classSlug = scope.classes?.some((c) => c.slug === p.classSlug) ? p.classSlug : null;
  // Неизвестный бренд в ссылке не должен давать пустую страницу без выхода — игнорируем его.
  const brandSlug = p.brandSlug && search.brands.some((b) => b.slug === p.brandSlug) ? p.brandSlug : null;
  const brandOffers = brandSlug ? offers.filter((o) => o.brandSlug === brandSlug) : offers;
  const scoped = classSlug ? brandOffers.filter((o) => classOf(o, scope) === classSlug) : brandOffers;
  const view = buildResultView(scoped, { ...p, classSlug, brandSlug }, { today, now, geo });
  const itemClassId = scope.itemClassId ?? scope.classes?.find((c) => c.slug === classSlug)?.id;

  const href = (patch: ParamsPatch) => resultHref(scope.path, patchParams(p, patch));
  const cityIn = `в ${city.namePrepositional ?? city.name}`;
  const microNames = new Map(geo.microdistricts.map((m) => [m.slug, m.name]));
  const brandName = brandSlug ? search.brands.find((b) => b.slug === brandSlug)?.name ?? null : null;
  const filtersOn = activeFilterCount(p.filters) > 0;
  // Чипы классов считают то, что попадёт в рейтинг: без цен на перепроверке.
  const fresh = (list: CompareOffer[]) => list.filter((o) => !isStale(o, today)).length;
  const faq = scope.faqTitle ? buildFaq({ title: scope.faqTitle, offers: scoped, today, cityIn }) : null;
  const items = view.sections.flatMap((s) => s.items);
  const hasOffers = scoped.length > 0 || view.recheck.length > 0;
  const scenario = {
    days: p.days,
    loc: p.loc.kind,
    ...(p.loc.kind === "microdistrict" ? { microdistrict: p.loc.microdistrict } : {}),
    ...(view.userOkrug ? { okrug: view.userOkrug } : {}),
  };

  const range = view.summary.min === null
    ? "подходящих предложений нет"
    : view.summary.min === view.summary.max
      ? `${formatRub(view.summary.min)} за ${daysLabel(p.days)}`
      : `от ${formatRub(view.summary.min)} до ${formatRub(view.summary.max!)} за ${daysLabel(p.days)}`;
  const summary = `${shopsLabel(view.summary.shops)} · ${range}`;
  const activeTab = view.tabs.find((t) => t.id === view.tab)!;
  const filtersProps = {
    path: scope.path,
    params: p,
    prices: view.prices,
    showModels: scope.showModels,
    activeTab: view.tab,
    guide: scope.guide ? { title: "Как выбрать", text: scope.guide } : null,
  };
  const resetHref = href({ tab: null, filters: { noMoneyDeposit: false, claimed: false, oneDay: false, openToday: false, models: [], okrugs: [] } });

  return (
    <main>
      <JsonLd data={buildBreadcrumbJsonLd(
        [{ name: "Главная", url: "/" }, ...scope.crumbs.map((c) => ({ name: c.label, url: c.href ?? scope.path }))],
        siteConfig.url,
      )} />
      {faq && <JsonLd data={buildFaqJsonLd(faq)} />}

      <div className="bg-header pb-4 md:pb-5">
        <div className="page">
          <SearchBar
            variant="compact"
            citySlug={city.slug}
            cityName={city.name}
            search={search}
            geo={geo}
            addressEnabled={suggestEnabled()}
            today={today}
            value={{
              what: { label: scope.what, target: scope.searchTarget },
              from: p.datesGiven ? p.from : null,
              to: p.datesGiven ? p.to : null,
              loc: p.loc,
            }}
          />
        </div>
      </div>

      <div className={cn(
        "page grid grid-cols-[minmax(0,1fr)] items-start gap-7 pb-12 pt-4 md:pt-6",
        hasOffers && "md:grid-cols-[260px_minmax(0,1fr)]",
      )}>
        {hasOffers && (
          <aside aria-label="Фильтры" className="hidden md:block">
            <FiltersPanel {...filtersProps} />
          </aside>
        )}

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <nav aria-label="Навигация" className="text-[13px] text-muted-foreground max-md:hidden">
              {scope.crumbs.slice(1, -1).map((c) => (
                <span key={c.label}>
                  {c.href ? <Link href={c.href as never} className="hover:text-accent">{c.label}</Link> : c.label}
                  {" / "}
                </span>
              ))}
              {scope.crumbs.at(-1)?.label}
            </nav>
            <h1 className="font-display text-2xl font-semibold tracking-display md:text-[28px]">{scope.title}</h1>
            {hasOffers && (
              <p className="text-sm text-muted-foreground max-md:hidden">
                {summary} · {whereText(p, geo, city.name)}
              </p>
            )}
            {hasOffers && !p.datesGiven && (
              <p className="text-sm font-semibold text-warn">Итог за 1 сутки — укажите даты для точного расчёта</p>
            )}
            {p.datesGiven && (
              <p className="text-sm text-muted-foreground md:hidden">{dateRangeLabel(p.from, p.to)} · {daysLabel(p.days)}</p>
            )}
          </div>

          {scope.chips && scope.chips.length > 0 && (
            <nav aria-label="Уточните" className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Уточните:</span>
              {scope.chips.map((c) => (
                <Link
                  key={c.label}
                  href={targetHref(city.slug, c.target, search.seoWords, p) as never}
                  className="inline-flex min-h-[40px] items-center rounded-pill border border-border-strong bg-card px-4 text-sm font-semibold hover:border-foreground"
                >
                  {c.label}
                </Link>
              ))}
            </nav>
          )}

          {scope.classes && scope.classes.length > 1 && (
            <ClassSwitch classes={[
              { slug: "", name: "Все", hint: null, count: fresh(brandOffers), href: href({ classSlug: null }), active: !classSlug },
              ...scope.classes.map((c) => ({
                slug: c.slug,
                name: c.name,
                hint: c.shortHint,
                count: fresh(brandOffers.filter((o) => classOf(o, scope) === c.slug)),
                href: href({ classSlug: c.slug, filters: { models: [] } }),
                active: c.slug === classSlug,
              })),
            ]} />
          )}

          {brandName && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Показаны только</span>
              <Link
                href={href({ brandSlug: null, filters: { models: [] } }) as never}
                scroll={false}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-pill border border-border-strong bg-card px-3 font-semibold hover:border-foreground"
              >
                {brandName}
                <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">— показать все бренды</span>
              </Link>
            </div>
          )}

          {hasOffers && <FiltersSheet
            {...filtersProps}
            summary={view.summary.min === null ? "нет предложений" : `${shopsLabel(view.summary.shops)}, от ${formatRub(view.summary.min)}`}
          />}

          {items.length > 0 && (
            <ResultTabs
              tabs={view.tabs}
              current={view.tab}
              hrefFor={Object.fromEntries(view.tabs.map((t) => [t.id, href({ tab: t.id })]))}
            />
          )}

          {view.hint && <SavingsHint hint={view.hint} weekHref={href({ from: p.from, to: addDaysStr(p.from, 7) })} />}

          {items.length === 0 ? (
            // Пусто из-за фильтров — предлагаем их сбросить; иначе предложений просто нет
            // (или только цены на перепроверке) — «не нашли» и форма «найдём за 30 минут».
            !filtersOn ? (
              <EmptyResult city={city} what={scope.what} period={p.datesGiven ? dateRangeLabel(p.from, p.to) : ""} similar={scope.similar} />
            ) : (
              <div className="rounded-lg border border-dashed border-border-strong p-6 text-center">
                <p className="font-semibold">Под эти условия предложений нет</p>
                <Link href={resetHref as never} scroll={false} className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">
                  Сбросить фильтры
                </Link>
              </div>
            )
          ) : (
            view.sections.map((sec, si) => (
              <section key={sec.title ?? si} className="flex flex-col gap-4" aria-label={sec.title ?? activeTab.label}>
                {sec.title && <h2 className="text-lg font-semibold">{sec.title}</h2>}
                <ol className="flex flex-col gap-4">
                  {sec.items.map((q, i) => {
                    const first = si === 0 && i === 0;
                    const o = q.offer as CompareOffer;
                    return (
                      <li key={o.id} className="flex flex-col gap-2">
                        <OfferTicket
                          item={q as typeof q & { offer: CompareOffer }}
                          rank={items.indexOf(q) + 1}
                          winnerLabel={first ? activeTab.winnerLabel : null}
                          tab={view.tab}
                          groupSlug={scope.iconGroup}
                          microdistrictName={o.place?.microdistrict ? microNames.get(o.place.microdistrict) ?? null : null}
                          openText={openLabel(openState(o.hours ?? null, now))}
                          scenario={scenario}
                          citySlug={city.slug}
                        />
                        {first && view.explanation && (
                          <p className="px-1 text-sm text-muted-foreground">{view.explanation}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))
          )}

          <OutOfRanking recheck={view.recheck} />

          <RegularRequestForm citySlug={city.slug} what={scope.what} itemClassId={itemClassId} />

          {faq && <CompareFaq items={faq} guide={scope.guide} title={scope.faqTitle!} />}
        </section>
      </div>
    </main>
  );
}

/** Класс предложения — для чипов классов на странице группы. */
function classOf(o: CompareOffer, scope: ResultScope): string | undefined {
  return scope.classes?.find((c) => c.id === o.itemClassId)?.slug;
}

/** Пустая выдача (ТЗ, п. 5.9): «Не нашли … в городе», похожее и форма заявки. */
function EmptyResult({
  city, what, period, similar,
}: {
  city: City;
  what: string;
  period: string;
  similar?: { label: string; href: string }[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-dashed border-border-strong p-6">
        <p className="font-semibold">Не нашли «{what}» в {city.namePrepositional ?? city.name}</p>
        {similar && similar.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Похожее:</span>
            {similar.map((s) => (
              <Link key={s.href} href={s.href as never} className="inline-flex min-h-[40px] items-center rounded-pill border border-border-strong bg-card px-4 text-sm font-semibold hover:border-foreground">
                {s.label}
              </Link>
            ))}
          </div>
        )}
      </div>
      <NotFoundRequestForm citySlug={city.slug} what={what} period={period} />
    </div>
  );
}
