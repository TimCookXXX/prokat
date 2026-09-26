import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, PhoneCall, Tags } from "lucide-react";
import { auth } from "@/lib/auth";
import { authPanelProps } from "@/lib/auth/panel-props";
import { getActiveCities, getCityBySlug } from "@/server/catalog";
import { getClaimableShops, getOwnedShops, getShopById, getUserClaims } from "@/server/shops";
import { DEFAULT_CITY_SLUG } from "@/lib/compare/catalog-data";
import { siteConfig } from "@/lib/site-config";
import { ShopClaimForm } from "@/components/compare/ShopClaimForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Для прокатов",
  description: "Подтвердите карточку проката на inrenta: обновляйте цены сами и получайте клиентов, которые сравнивают итог за свои даты.",
  alternates: { canonical: `${siteConfig.url}/dlya-prokatov` },
};

const BENEFITS = [
  { Icon: PhoneCall, title: "Клиенты без рекламы", text: "Люди сравнивают итог за свои даты и звонят вам напрямую. Мы ничего не сдаём и не берём оплату за аренду." },
  { Icon: Tags, title: "Цены — ваши", text: "Обновляйте цены и условия сами: изменения сразу попадают в сравнение, с датой проверки и бейджем «Подтвердил цены»." },
  { Icon: BarChart3, title: "Отчёт об обращениях", text: "Сколько раз показали ваш телефон и на каком месте вы в сравнении — по месяцам." },
];

const STEPS = [
  "Найдите свой прокат в списке — карточку мы, скорее всего, уже составили по открытым данным.",
  "Оставьте телефон. Мы позвоним на номер проката и сверим, что вы — это вы.",
  "Ведите цены в кабинете проката. Цены, которые не обновлялись 30 дней, уходят на перепроверку.",
];

const CLAIM_STATUS: Record<string, string> = { new: "на проверке", approved: "одобрена", rejected: "отклонена" };

export default async function ForShopsPage({ searchParams }: { searchParams: Promise<{ shop?: string }> }) {
  const { shop: shopParam } = await searchParams;
  const [session, preselected] = await Promise.all([auth(), shopParam ? getShopById(shopParam) : null]);
  const city = preselected
    ? await getCityBySlug(preselected.citySlug)
    : (await getCityBySlug(DEFAULT_CITY_SLUG)) ?? (await getActiveCities())[0] ?? null;
  const user = session?.user;
  const [shops, owned, claims] = await Promise.all([
    city ? getClaimableShops(city.id) : [],
    user ? getOwnedShops(user.id) : [],
    user ? getUserClaims(user.id) : [],
  ]);
  const returnTo = `/dlya-prokatov${shopParam ? `?shop=${encodeURIComponent(shopParam)}` : ""}#claim`;

  return (
    <main>
      <section className="bg-header pb-12 pt-8 text-header-foreground md:pb-14 md:pt-12">
        <div className="page flex max-w-3xl flex-col gap-4">
          <h1 className="font-display text-[28px] font-semibold leading-tight md:text-[40px]">Для прокатов</h1>
          <p className="text-base text-header-muted md:text-lg">
            Мы показываем цены прокатов города в одном сравнении — и ваши тоже, если нашли их в открытых источниках.
            Подтвердите карточку, чтобы вести её самим.
          </p>
          <p className="text-sm text-header-muted">
            Сейчас — бесплатно. Если введём оплату, то только за обращения клиентов, и предупредим заранее.
          </p>
        </div>
      </section>

      <div className="page flex flex-col gap-10 pb-14 pt-10">
        {owned.length > 0 && (
          <div className="rounded-lg bg-ok-soft p-5 text-ok">
            Вы ведёте {owned.map((s) => `«${s.name}»`).join(", ")}.{" "}
            <Link href="/moy-prokat" className="font-semibold underline">Открыть кабинет проката</Link>
          </div>
        )}

        <section aria-label="Что даёт подтверждение" className="grid gap-4 md:grid-cols-3">
          {BENEFITS.map(({ Icon, title, text }) => (
            <div key={title} className="flex flex-col gap-2 rounded-lg bg-card p-5 shadow-card">
              <Icon className="h-6 w-6 text-accent" aria-hidden="true" />
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-3">
          <h2 id="how" className="font-display text-xl font-semibold">Как подтвердить</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px]">
            {STEPS.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </section>

        <section id="claim" aria-labelledby="claim-title" className="flex scroll-mt-6 flex-col gap-4 rounded-lg bg-card p-5 shadow-card md:p-6">
          <h2 id="claim-title" className="font-display text-xl font-semibold">
            {preselected ? `Это ваш прокат — «${preselected.name}»?` : "Это ваш прокат?"}
          </h2>
          {preselected?.status === "claimed" ? (
            <p className="text-sm text-muted-foreground">Эту карточку уже подтвердил прокат. Если это ошибка — напишите нам.</p>
          ) : city ? (
            <ShopClaimForm
              citySlug={city.slug}
              shops={shops}
              shopId={preselected?.id}
              authProps={authPanelProps()}
              isAuthed={!!user}
              returnTo={returnTo}
            />
          ) : null}
          {claims.length > 0 && (
            <div className="border-t border-border pt-4 text-sm">
              <h3 className="mb-2 font-semibold">Ваши заявки</h3>
              <ul className="flex flex-col gap-1 text-muted-foreground">
                {claims.map((c) => (
                  <li key={c.id}>
                    {c.name} · {c.createdAt.toLocaleDateString("ru-RU")} · {CLAIM_STATUS[c.status]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
