import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRub, type Quote, type TabId } from "@/lib/compare/pricing";
import { depositLabel, minTermLabel, quoteBreakdown, weekLabel, type CompareOffer } from "@/lib/compare/view";
import { shortDate } from "@/lib/compare/format";
import { PhoneReveal } from "./PhoneReveal";
import { OutdatedPrice } from "./OutdatedPrice";

const chip = "rounded-chip px-2.5 py-1 text-[13px]";
const chipTone = { normal: "bg-background", warn: "bg-warn-soft text-warn" } as const;

/** Бейдж «Подтвердил цены» — прокат сам ведёт карточку. */
export function ClaimedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      Подтвердил цены
    </span>
  );
}

// «Билет» (DESIGN_SYSTEM → OfferTicket). Одна разметка на обе ширины: порядок
// частей задают grid-areas. Телефон: итог сверху, горизонтальный пунктир,
// детали, кнопка. Десктоп: слева итог и кнопка (240px), вертикальный пунктир
// с полукруглыми вырезами цвета фона, справа детали.
export function OfferTicket({
  quote: q,
  rank,
  winnerLabel,
  needDelivery,
  days,
  tab,
  citySlug,
}: {
  quote: Quote & { offer: CompareOffer };
  rank: number;
  /** Подпись победителя вкладки — только у первого в выдаче. */
  winnerLabel?: string | null;
  needDelivery: boolean;
  /** Сколько суток запросил человек — для учёта обращения. */
  days: number;
  tab: TabId;
  /** Куда привезти — для учёта обращения. */
  citySlug: string;
}) {
  const o = q.offer;
  const dep = depositLabel(o);
  const min = minTermLabel(o);
  const when = !needDelivery
    ? "самовывоз"
    : o.delivery.sameDay ? "привезут в день заказа" : "доставка к началу аренды";

  return (
    <article
      className={cn(
        "relative grid rounded-lg bg-card shadow-card",
        "[grid-template-areas:'total'_'details'_'action']",
        "md:grid-cols-[240px_minmax(0,1fr)] md:[grid-template-areas:'total_details'_'action_details']",
      )}
    >
      <div className="flex flex-col gap-1.5 border-b-2 border-dashed border-border px-4 pb-3.5 pt-4 [grid-area:total] md:gap-2.5 md:border-b-0 md:border-r-2 md:px-[22px] md:pb-2.5 md:pt-5">
        {winnerLabel && <span className="text-xs font-bold text-cta">{winnerLabel}</span>}
        <span className="price text-[26px] leading-none md:text-[30px]">{formatRub(q.total)}</span>
        <span className="text-xs leading-snug text-muted-foreground">{quoteBreakdown(q, needDelivery)}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 px-4 pt-3.5 [grid-area:details] md:px-[22px] md:py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold md:text-lg">
            <Link href={`/${citySlug}/prokaty/${o.shopSlug}` as never} className="hover:text-accent">
              {o.shopName}
            </Link>
          </h3>
          {o.claimed && <ClaimedBadge />}
        </div>
        <p className="text-sm text-muted-foreground">
          {[o.model, o.district].filter(Boolean).join(" · ")}
          {(o.model || o.district) && " · "}
          <span className={cn(needDelivery && o.delivery.sameDay && "font-semibold text-ok")}>{when}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn(chip, chipTone[dep.tone])}>{dep.text}</span>
          <span className={cn(chip, chipTone[min.tone])}>{min.text}</span>
          {o.priceDay != null && <span className={cn(chip, chipTone.normal)}>{weekLabel(o)}</span>}
          <span className="px-0.5 py-1 text-[13px] text-muted-foreground">Цена проверена {shortDate(o.verifiedAt)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pb-4 pt-3 [grid-area:action] md:border-r-2 md:border-dashed md:border-border md:px-[22px] md:pb-5 md:pt-0">
        <PhoneReveal
          offerId={o.id}
          winner={!!winnerLabel}
          tab={tab}
          rank={rank}
          scenario={{ days, needDelivery }}
        />
        <OutdatedPrice offerId={o.id} />
      </div>

      {/* Вырезы «билета» на стыке частей — цвета фона страницы. */}
      <span aria-hidden="true" className="absolute left-[229px] top-[-1px] hidden h-[11px] w-[22px] rounded-b-full bg-background md:block" />
      <span aria-hidden="true" className="absolute bottom-[-1px] left-[229px] hidden h-[11px] w-[22px] rounded-t-full bg-background md:block" />
    </article>
  );
}
