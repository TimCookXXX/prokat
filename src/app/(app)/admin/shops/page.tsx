import type { Metadata } from "next";
import Link from "next/link";
import { adminListClaims, adminListShops } from "@/server/shops";
import { adminApproveClaim, adminRejectClaim, adminSetShopHidden } from "@/server/actions/shops";
import { ActionButton } from "@/components/admin/ActionButton";
import { formatPhone, shortDate } from "@/lib/compare/format";
import { SHOPS_SEGMENT } from "@/lib/compare/catalog-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Прокаты — админка", robots: { index: false } };

const STATUS: Record<string, string> = { new: "новая", approved: "одобрена", rejected: "отклонена" };
const SHOP_STATUS: Record<string, string> = { unclaimed: "составил inrenta", claimed: "подтверждена", hidden: "скрыт" };

export default async function AdminShopsPage() {
  const [claims, shops] = await Promise.all([adminListClaims(), adminListShops()]);
  const row = "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3";

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="claims">
        <h2 id="claims" className="mb-1 text-lg font-semibold">Заявки «Это мой прокат»</h2>
        <p className="mb-3 text-sm text-muted-foreground">Перед одобрением позвоните на номер проката и сверьте, что заявитель оттуда.</p>
        {claims.length === 0 ? <p className="text-sm text-muted-foreground">Заявок нет.</p> : (
          <ul className="flex flex-col gap-2">
            {claims.map(({ claim, shop, user, citySlug }) => (
              <li key={claim.id} className={row}>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {shop
                      ? <Link href={`/${citySlug}/${SHOPS_SEGMENT}/${shop.slug}` as never} className="hover:text-accent">{shop.name}</Link>
                      : <>{claim.shopName} <span className="text-muted-foreground">(нового проката нет в базе)</span></>}
                    <span className="ml-2 rounded-pill bg-muted px-2 py-0.5 text-xs text-muted-foreground">{STATUS[claim.status]}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {claim.contactName} · {formatPhone(claim.phone)} · {user.email}
                    {shop?.phone ? ` · телефон проката ${formatPhone(shop.phone)}` : ""} · {claim.createdAt.toLocaleDateString("ru-RU")}
                  </p>
                  {claim.comment && <p className="mt-1">{claim.comment}</p>}
                </div>
                {claim.status === "new" && (
                  <div className="flex gap-2">
                    <ActionButton label="Одобрить" variant="default" confirmText="Звонок проката подтвердил заявителя?" action={adminApproveClaim.bind(null, claim.id)} />
                    <ActionButton label="Отклонить" variant="ghost" confirmText="Отклонить заявку?" action={adminRejectClaim.bind(null, claim.id)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="shops">
        <h2 id="shops" className="mb-3 text-lg font-semibold">Прокаты ({shops.length})</h2>
        <p className="mb-3 text-sm text-muted-foreground">Прокаты и цены заводятся CSV-импортом (<code>import-offers</code>, см. docs/DEPLOY.md).</p>
        <ul className="flex flex-col gap-2">
          {shops.map((s) => (
            <li key={s.id} className={row}>
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  <Link href={`/${s.citySlug}/${SHOPS_SEGMENT}/${s.slug}` as never} className="hover:text-accent">{s.name}</Link>
                  <span className="ml-2 rounded-pill bg-muted px-2 py-0.5 text-xs text-muted-foreground">{SHOP_STATUS[s.status]}</span>
                </p>
                <p className="text-muted-foreground">
                  {[s.district, s.phone ? formatPhone(s.phone) : "нет телефона", `${s.offers} предл.`, s.lastVerified ? `проверено ${shortDate(s.lastVerified)}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <ActionButton
                label={s.status === "hidden" ? "Вернуть в выдачу" : "Скрыть"}
                variant="ghost"
                confirmText={s.status === "hidden" ? undefined : "Скрыть прокат из сравнения?"}
                action={adminSetShopHidden.bind(null, s.id, s.status !== "hidden")}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
