import Link from "next/link";
import { X } from "lucide-react";
import { notFound } from "next/navigation";
import type { City } from "@/server/catalog";
import {
  getClassOfferCounts, getClassOffers, getCompareCatalog, getSearchModels, toSearchData,
  type GroupWithClasses,
} from "@/server/compare";
import { addDaysStr } from "@/lib/catalog/dates";
import { STALE_AFTER_DAYS, formatRub } from "@/lib/compare/pricing";
import {
  compareHref, localToday, parseCompareParams, patchParams, type CompareParams,
} from "@/lib/compare/scenario";
import { buildCompareView } from "@/lib/compare/view";
import { buildFaq } from "@/lib/compare/faq";
import { compareTitle, daysLabel, shopsLabel } from "@/lib/compare/format";
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
import { CompareFaq } from "./CompareFaq";

type RawParams = Record<string, string | string[] | undefined>;

/** Параметры страницы и выбранный класс; класс по умолчанию — первый в группе. */
export function resolveCompareParams(g: GroupWithClasses, sp: RawParams, today: string) {
  const p = parseCompareParams(sp, today);
  const cls = g.classes.find((c) => c.slug === p.classSlug) ?? g.classes[0];
  return { p: { ...p, classSlug: cls?.slug ?? null } as CompareParams, cls };
}

// Страница сравнения /{city}/{group} (DESIGN_SYSTEM, макеты CompareB/MobileB):
// итог за даты человека у каждого проката, вкладки, фильтры, «билеты».
// Всё считается на сервере по параметрам из URL — ссылка открывает ту же выдачу.
export async function ComparePage({ city, g, searchParams }: { city: City; g: GroupWithClasses; searchParams: RawParams }) {
  const today = localToday();
  const { p, cls } = resolveCompareParams(g, searchParams, today);
  if (!cls) notFound();

  const freshSince = addDaysStr(today, -STALE_AFTER_DAYS);
  const [offers, counts, catalog, models] = await Promise.all([
    getClassOffers(city.id, cls.id),
    getClassOfferCounts(city.id, g.classes.map((c) => c.id)),
    getCompareCatalog(city.id, freshSince),
    getSearchModels(city.id, freshSince),
  ]);
  const view = buildCompareView(offers, p, today);
  const title = compareTitle(g.group, city);
  const cityIn = `в ${city.namePrepositional ?? city.name}`;
  const faq = buildFaq({ title: title.replace(` ${cityIn}`, ""), offers, today, cityIn });
  const href = (patch: Parameters<typeof patchParams>[1]) => compareHref(city.slug, g.group.slug, patchParams(p, patch));
  const basePath = `/${city.slug}/${g.group.slug}`;

  const getting = p.pickup ? "самовывозом" : "с доставкой";
  const range = view.summary.min === null
    ? "подходящих предложений нет"
    : view.summary.min === view.summary.max
      ? formatRub(view.summary.min)
      : `от ${formatRub(view.summary.min)} до ${formatRub(view.summary.max!)}`;
  const summary = `${shopsLabel(view.summary.shops)} · итог за ${daysLabel(p.days)} ${getting} · ${range}`;
  const activeTab = view.tabs.find((t) => t.id === p.tab)!;
  const filtersProps = {
    citySlug: city.slug,
    groupSlug: g.group.slug,
    params: p,
    prices: view.prices,
    guide: g.group.guide ? { title: "Как выбрать", text: g.group.guide } : null,
  };
  const resetHref = href({ tab: "cheapest", model: null, filters: { noMoneyDeposit: false, sameDay: false, claimed: false, oneDay: false, areas: [] } });

  return (
    <main>
      <JsonLd data={buildBreadcrumbJsonLd([
        { name: "Главная", url: "/" },
        { name: city.name, url: `/${city.slug}` },
        { name: g.category.name, url: `/${city.slug}/${g.category.slug}` },
        { name: title, url: basePath },
      ], siteConfig.url)} />
      <JsonLd data={buildFaqJsonLd(faq)} />

      <div className="bg-header pb-4 md:pb-5">
        <div className="page">
          <SearchBar
            variant="compact"
            citySlug={city.slug}
            search={toSearchData(catalog, models)}
            today={today}
            value={{ groupSlug: g.group.slug, classSlug: cls.slug, model: p.model, from: p.from, to: p.to, pickup: p.pickup }}
          />
        </div>
      </div>

      <div className="page grid grid-cols-[minmax(0,1fr)] items-start gap-7 pb-12 pt-4 md:grid-cols-[260px_minmax(0,1fr)] md:pt-6">
        <aside aria-label="Фильтры" className="hidden md:block">
          <FiltersPanel {...filtersProps} />
        </aside>

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <nav aria-label="Навигация" className="text-[13px] text-muted-foreground max-md:hidden">
              <Link href={`/${city.slug}/${g.category.slug}` as never} className="hover:text-accent">{g.category.name}</Link>
              {" / "}{g.group.name}
            </nav>
            <h1 className="font-display text-2xl font-semibold tracking-display md:text-[28px]">{title}</h1>
            <p className="text-sm text-muted-foreground max-md:hidden">{summary}</p>
          </div>

          <ClassSwitch classes={g.classes.map((c) => ({
            slug: c.slug,
            name: c.name,
            hint: c.shortHint,
            count: counts.get(c.id) ?? 0,
            href: href({ classSlug: c.slug, model: null, filters: { areas: [] } }),
            active: c.id === cls.id,
          }))} />

          {p.model && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Показаны только</span>
              <Link
                href={href({ model: null }) as never}
                scroll={false}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-pill border border-border-strong bg-card px-3 font-semibold hover:border-foreground"
              >
                {p.model}
                <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">— показать все модели</span>
              </Link>
            </div>
          )}

          <FiltersSheet {...filtersProps} summary={view.summary.min === null ? "нет предложений" : `${shopsLabel(view.summary.shops)}, от ${formatRub(view.summary.min)}`} />

          <ResultTabs
            tabs={view.tabs}
            current={p.tab}
            hrefFor={Object.fromEntries(view.tabs.map((t) => [t.id, href({ tab: t.id })]))}
          />

          {view.hint && <SavingsHint hint={view.hint} weekHref={href({ to: addDaysStr(p.from, 7) })} />}

          {view.list.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong p-6 text-center">
              <p className="font-semibold">
                {offers.length === 0 ? "Цены по этому классу ещё собираем" : "Под эти условия предложений нет"}
              </p>
              {offers.length > 0 && (
                <Link href={resetHref as never} scroll={false} className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">
                  Сбросить фильтры
                </Link>
              )}
            </div>
          ) : (
            <ol className="flex flex-col gap-4" aria-label={activeTab.label}>
              {view.list.map((q, i) => (
                <li key={q.offer.id}>
                  <OfferTicket
                    quote={q as typeof q & { offer: (typeof offers)[number] }}
                    rank={i + 1}
                    winnerLabel={i === 0 ? activeTab.winnerLabel : null}
                    needDelivery={!p.pickup}
                    days={p.days}
                    tab={p.tab}
                    citySlug={city.slug}
                  />
                </li>
              ))}
            </ol>
          )}

          {view.noDepNote && (
            <p className="px-1 text-sm text-muted-foreground">
              Остальные {shopsLabel(view.noDepNote.others)} просят денежный залог
              от {formatRub(view.noDepNote.minDeposit)} до {formatRub(view.noDepNote.maxDeposit)}.
            </p>
          )}

          <OutOfRanking recheck={view.recheck} pickupOnly={view.pickupOnly} pickupHref={href({ pickup: true, filters: { sameDay: false } })} />

          <RegularRequestForm citySlug={city.slug} what={cls.name} itemClassId={cls.id} />

          <CompareFaq items={faq} guide={g.group.guide} title={title.replace(` ${cityIn}`, "")} />
        </section>
      </div>
    </main>
  );
}
