import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { requireAuthState } from "@/lib/auth/guard";
import { getCityBySlug } from "@/server/catalog";
import { getCompareCatalog } from "@/server/compare";
import { getCityOffersByClass, getOwnedShops, getShopLeadCounts, getShopOffers } from "@/server/shops";
import { addDaysStr } from "@/lib/catalog/dates";
import { STALE_AFTER_DAYS, formatRub, rentalDays } from "@/lib/compare/pricing";
import { localToday } from "@/lib/compare/scenario";
import { placeInComparison, placeLabel } from "@/lib/compare/view";
import { shortDate } from "@/lib/compare/format";
import { ruPlural } from "@/lib/plural";
import { SHOPS_SEGMENT } from "@/lib/compare/catalog-data";
import { ShopPricesForm, type EditableOffer } from "@/components/shop/ShopPricesForm";
import { AddOfferForm } from "@/components/shop/AddOfferForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Кабинет проката", robots: { index: false } };

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** Начало месяца по московскому времени, со сдвигом на n месяцев. */
function monthStart(today: string, shift: number): Date {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + shift, 1));
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00+03:00`);
}

const str = (n: number | null) => (n === null ? "" : String(n));

// Кабинет проката (макет Cabinet варианта А): цены и условия, место в сравнении,
// обращения за месяц. Доступен владельцу подтверждённой карточки.
export default async function ShopCabinetPage({ searchParams }: { searchParams: Promise<{ shop?: string }> }) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/moy-prokat");
  const owned = await getOwnedShops(session.user.id);
  const { shop: shopParam } = await searchParams;

  if (owned.length === 0) {
    return (
      <main className="page max-w-2xl py-12">
        <h1 className="mb-3 font-display text-2xl font-semibold">Кабинет проката</h1>
        <p className="text-muted-foreground">
          У вас пока нет подтверждённого проката. <Link href="/dlya-prokatov" className="font-semibold text-accent hover:underline">Подтвердите карточку</Link> — после проверки звонком здесь появятся ваши цены и отчёт.
        </p>
      </main>
    );
  }

  const shop = owned.find((s) => s.id === shopParam) ?? owned[0];
  const today = localToday();
  const city = await getCityBySlug(shop.citySlug);
  const [rows, thisMonth, lastMonth, catalog] = await Promise.all([
    getShopOffers(shop, { activeOnly: false }),
    getShopLeadCounts(shop.id, monthStart(today, 0), monthStart(today, 1)),
    getShopLeadCounts(shop.id, monthStart(today, -1), monthStart(today, 0)),
    city ? getCompareCatalog(city.id, addDaysStr(today, -STALE_AFTER_DAYS)) : [],
  ]);
  const byClass = city ? await getCityOffersByClass(city.id, [...new Set(rows.map((r) => r.cls.id))]) : new Map();
  const scenario = { days: 1, needDelivery: true };

  const editable: EditableOffer[] = rows.map((r) => {
    const p = r.isActive ? placeInComparison(byClass.get(r.cls.id) ?? [], r.offer.id, scenario, today) : null;
    const gap = p?.kind === "ranked" && p.place > 1 ? ` · до 1-го места — ${formatRub(p.gapToFirst)}` : p?.kind === "ranked" ? " · самый выгодный" : "";
    const o = r.offer;
    return {
      id: o.id,
      title: r.cls.name,
      model: o.model ?? null,
      isActive: r.isActive,
      place: r.isActive ? `${placeLabel(p)}${gap}` : "не в сравнении",
      draft: {
        priceDay: str(o.priceDay), priceWeek: str(o.priceWeek ?? null), minDays: String(o.minDays),
        depositRub: str(o.depositRub), depositDocument: o.depositDocument,
        deliveryAvailable: o.delivery.available, deliveryPrice: str(o.delivery.price),
        deliveryFreeFrom: str(o.delivery.freeFrom ?? null), deliverySameDay: o.delivery.sameDay,
      },
    };
  });

  const active = rows.filter((r) => r.isActive).map((r) => r.offer.verifiedAt).sort();
  const oldest = active[0];
  const staleOn = oldest ? addDaysStr(oldest, STALE_AFTER_DAYS + 1) : null;
  const daysLeft = staleOn ? rentalDays(today, staleOn) : null;
  const [, m] = today.split("-").map(Number);
  const report: [string, string, number, number][] = [
    ["show_phone", "Показали ваш телефон", thisMonth.show_phone ?? 0, lastMonth.show_phone ?? 0],
    ["price_outdated", "Сообщили «цена устарела»", thisMonth.price_outdated ?? 0, lastMonth.price_outdated ?? 0],
  ];

  return (
    <main className="page flex max-w-4xl flex-col gap-8 pb-14 pt-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Кабинет проката</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold md:text-[28px]">{shop.name}</h1>
          <span className="inline-flex items-center gap-1 rounded-sm bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Карточка подтверждена
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={`/${shop.citySlug}/${SHOPS_SEGMENT}/${shop.slug}` as never} className="text-accent hover:underline">Карточка на сайте</Link>
          {owned.length > 1 && owned.filter((s) => s.id !== shop.id).map((s) => (
            <Link key={s.id} href={`/moy-prokat?shop=${s.id}` as never} className="text-muted-foreground hover:text-accent">{s.name}</Link>
          ))}
        </div>
      </div>

      <section aria-labelledby="report" className="flex flex-col gap-3">
        <h2 id="report" className="font-display text-xl font-semibold">Сколько клиентов пришло через inrenta</h2>
        <div className="overflow-hidden rounded-lg bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-medium" />
                <th className="px-4 py-3 text-right font-medium">{MONTHS[(m + 10) % 12]}</th>
                <th className="px-4 py-3 text-right font-medium">{MONTHS[m - 1]}</th>
              </tr>
            </thead>
            <tbody>
              {report.map(([k, label, now, prev]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{label}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{prev}</td>
                  <td className="price px-4 py-3 text-right">{now}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Сейчас — бесплатно. Звонки через подменный номер появятся вместе с оплатой за обращения.</p>
      </section>

      {staleOn && (
        <p className={`rounded-field px-4 py-3 text-sm ${daysLeft !== null && daysLeft <= 7 ? "bg-warn-soft text-warn" : "bg-card"}`}>
          Самая старая цена проверена {shortDate(oldest!)}. Без обновления с {shortDate(staleOn)} она уйдёт на перепроверку
          {daysLeft !== null && daysLeft > 0 ? ` — осталось ${daysLeft} ${ruPlural(daysLeft, "день", "дня", "дней")}` : ""}.
        </p>
      )}

      <section aria-labelledby="prices" className="flex flex-col gap-3">
        <h2 id="prices" className="font-display text-xl font-semibold">Ваши цены</h2>
        <p className="text-sm text-muted-foreground">Место — по итогу за 1 сутки с доставкой среди прокатов города.</p>
        {editable.length > 0 ? <ShopPricesForm shopId={shop.id} offers={editable} /> : <p className="text-sm text-muted-foreground">Цен пока нет — добавьте первый инструмент.</p>}
        <AddOfferForm
          shopId={shop.id}
          classes={catalog.flatMap((c) => c.groups.map((g) => ({ group: `${c.name} · ${g.name}`, items: g.classes })))}
        />
      </section>
    </main>
  );
}
