import Link from "next/link";
import { BadgeCheck, FileText } from "lucide-react";
import type { City } from "@/server/catalog";
import type { RentalShop } from "@/server/compare";
import { getCityOffersByClass, getShopOffers, type ShopOfferRow } from "@/server/shops";
import { formatRub } from "@/lib/compare/pricing";
import { deliverySummary, depositSummary, placeInComparison, placeLabel, type Place } from "@/lib/compare/view";
import { emptyParams, groupPath, localToday, patchParams, resultHref } from "@/lib/compare/scenario";
import { daysLabel, shortDate } from "@/lib/compare/format";
import { ruPlural } from "@/lib/plural";
import { buildBreadcrumbJsonLd, type JsonLd as LdObject } from "@/lib/jsonld";
import { siteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/seo/JsonLd";
import { ClaimedBadge } from "./OfferTicket";
import { PhoneReveal } from "./PhoneReveal";
import { ClaimLink } from "./ClaimLink";

// Страница проката /{city}/prokaty/{slug} (макет Shop варианта А в стиле Б):
// условия, цены по классам с местом в сравнении, статус карточки.
export async function ShopPage({ city, shop }: { city: City; shop: RentalShop }) {
  const today = localToday();
  const rows = await getShopOffers(shop);
  const byClass = await getCityOffersByClass(city.id, [...new Set(rows.map((r) => r.cls.id))]);
  const offers = rows.map((r) => r.offer);
  // Место — по итогу за 1 сутки среди предложений класса в городе.
  const place = (r: ShopOfferRow): Place | null => placeInComparison(byClass.get(r.cls.id) ?? [], r.offer.id, 1, today);
  const lastChecked = offers.map((o) => o.verifiedAt).sort().at(-1);
  const minDays = offers.length ? Math.min(...offers.map((o) => o.minDays)) : null;
  const classes = new Set(rows.map((r) => r.cls.id)).size;
  const claimed = shop.status === "claimed";
  const defaults = emptyParams(today);
  const cityIn = `в ${city.namePrepositional ?? city.name}`;

  const facts: [string, string][] = [
    ["Залог", depositSummary(offers)],
    ["Доставка", deliverySummary(offers)],
    ["Минимальный срок", minDays ? daysLabel(minDays) : "—"],
    ["В сравнении", `${classes} ${ruPlural(classes, "вид", "вида", "видов")}`],
  ];

  const ld: LdObject = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: shop.name,
    url: `${siteConfig.url}/${city.slug}/prokaty/${shop.slug}`,
    address: { "@type": "PostalAddress", addressLocality: city.name, ...(shop.address ? { streetAddress: shop.address } : {}) },
  };

  return (
    <main className="page flex flex-col gap-6 pb-14 pt-6 md:pt-8">
      <JsonLd data={ld} />
      <JsonLd data={buildBreadcrumbJsonLd([
        { name: city.name, url: `/${city.slug}` },
        { name: "Прокаты", url: `/${city.slug}/prokaty` },
        { name: shop.name },
      ], siteConfig.url)} />

      <nav aria-label="Навигация" className="text-[13px] text-muted-foreground">
        <Link href={`/${city.slug}` as never} className="hover:text-accent">{city.name}</Link>
        {" / "}
        <Link href={`/${city.slug}/prokaty` as never} className="hover:text-accent">Прокаты</Link>
        {" / "}{shop.name}
      </nav>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px] md:items-start">
        <div className="flex flex-col gap-4 rounded-lg bg-card p-5 shadow-card md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-display md:text-[28px]">{shop.name}</h1>
            {claimed && <ClaimedBadge />}
          </div>
          <p className="text-sm text-muted-foreground">
            Прокат {cityIn}{shop.microdistrict ? ` · ${shop.microdistrict.name}` : ""}{shop.address ? `, ${shop.address}` : ""}
          </p>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k} className="rounded-field bg-background px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <PhoneReveal shopId={shop.id} winner className="max-w-xs" />
        </div>

        <aside className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong p-5">
          {claimed ? (
            <>
              <span className="flex items-center gap-2 text-[15px] font-semibold text-ok">
                <BadgeCheck className="h-5 w-5" aria-hidden="true" /> Карточка подтверждена
              </span>
              <p className="text-sm text-muted-foreground">Цены обновляет сам прокат{lastChecked ? ` — последний раз ${shortDate(lastChecked)}` : ""}.</p>
            </>
          ) : (
            <>
              <span className="flex items-center gap-2 text-[15px] font-semibold">
                <FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Карточку составил inrenta
              </span>
              <p className="text-sm text-muted-foreground">
                {lastChecked ? `Цены проверены ${shortDate(lastChecked)} по открытым источникам и звонком. ` : ""}
                Прокат ещё не подтвердил карточку.
              </p>
              <ClaimLink shopId={shop.id} className="text-sm font-semibold text-accent hover:underline">
                Это ваш прокат? Подтвердить
              </ClaimLink>
              <p className="text-xs text-muted-foreground">
                После подтверждения вы сами обновляете цены и видите отчёт об обращениях.
              </p>
            </>
          )}
        </aside>
      </div>

      <section aria-labelledby="prices" className="flex flex-col gap-3">
        <h2 id="prices" className="font-display text-xl font-semibold">Цены проката</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Цен пока нет.</p>
        ) : (
          <div className="overflow-hidden rounded-lg bg-card shadow-card">
            <table className="w-full text-sm max-md:block">
              <thead className="text-left text-xs text-muted-foreground max-md:hidden">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-medium">Что</th>
                  <th className="px-4 py-3 font-medium">Модель</th>
                  <th className="px-4 py-3 text-right font-medium">₽ / сутки</th>
                  <th className="px-4 py-3 text-right font-medium">₽ / неделя</th>
                  <th className="px-4 py-3 font-medium">Место в сравнении</th>
                  <th className="px-4 py-3 font-medium">Проверено</th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {rows.map((r) => {
                  const p = place(r);
                  const href = resultHref(groupPath(city.slug, r.group.slug), patchParams(defaults, { classSlug: r.cls.slug }));
                  return (
                    <tr key={r.offer.id} className="border-b border-border last:border-0 max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-1 max-md:px-4 max-md:py-3">
                      <td className="px-4 py-3 font-semibold max-md:col-span-2 max-md:p-0">
                        <Link href={href as never} className="hover:text-accent">{r.cls.name}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-md:col-span-2 max-md:p-0">{r.offer.model ?? "—"}</td>
                      <td className="price px-4 py-3 text-right max-md:p-0 max-md:text-left">{r.offer.priceDay != null ? formatRub(r.offer.priceDay) : "—"}<span className="font-text font-normal text-muted-foreground md:hidden"> / сутки</span></td>
                      <td className="price px-4 py-3 text-right max-md:p-0">{r.offer.priceWeek ? formatRub(r.offer.priceWeek) : "—"}<span className="font-text font-normal text-muted-foreground md:hidden"> / неделя</span></td>
                      <td className="px-4 py-3 max-md:p-0">{placeLabel(p)}</td>
                      <td className="px-4 py-3 text-muted-foreground max-md:p-0 max-md:text-right">{shortDate(r.offer.verifiedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[13px] text-muted-foreground">
          Место считаем по итогу за 1 сутки среди всех прокатов города.{" "}
          <Link href="/kak-schitaem-ceny" className="text-accent hover:underline">Как считаем цены</Link>
        </p>
      </section>
    </main>
  );
}
