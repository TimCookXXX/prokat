import Link from "next/link";
import { Check, Clock, MapPin } from "lucide-react";
import type { LeadScenario } from "@db/schema";
import { cn } from "@/lib/utils";
import { formatRub } from "@/lib/compare/pricing";
import type { Placed, TabId } from "@/lib/compare/ranking";
import { depositLabel, minTermLabel, quoteBreakdown, weekLabel, type CompareOffer } from "@/lib/compare/view";
import { tripLabel } from "@/lib/compare/geo";
import { shortDate } from "@/lib/compare/format";
import { groupIcon } from "./GroupCard";
import { PhoneReveal } from "./PhoneReveal";
import { OutdatedPrice } from "./OutdatedPrice";

const chip = "rounded-chip px-2.5 py-1 text-[13px]";
const chipTone = { normal: "bg-background", warn: "bg-warn-soft text-warn" } as const;

/** Бейдж «Прокат подтвердил цены» — прокат сам ведёт карточку. */
export function ClaimedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      Прокат подтвердил цены
    </span>
  );
}

/** Где прокат (ТЗ, п. 5.4): адрес, «<микрорайон>, адрес уточняйте» или «Адрес уточняйте у проката». */
export function placeText(o: CompareOffer, microdistrictName: string | null): string {
  if (o.place?.address) return microdistrictName ? `${microdistrictName}, ${o.place.address}` : o.place.address;
  if (microdistrictName) return `${microdistrictName}, адрес уточняйте`;
  return "Адрес уточняйте у проката";
}

// Карточка предложения — «билет» (DESIGN_SYSTEM → OfferTicket; ТЗ, п. 5.4). Одна
// разметка на обе ширины: порядок частей задают grid-areas. Телефон: итог
// сверху, пунктир, детали, кнопка. Десктоп: слева итог и кнопка (240px),
// вертикальный пунктир с вырезами цвета фона, справа детали.
export function OfferTicket({
  item: q,
  rank,
  winnerLabel,
  tab,
  groupSlug,
  microdistrictName,
  openText,
  scenario,
  citySlug,
}: {
  item: Placed & { offer: CompareOffer };
  rank: number;
  /** Подпись победителя вкладки — только у первого в выдаче. */
  winnerLabel?: string | null;
  tab: TabId;
  /** Для пиктограммы вместо фото. */
  groupSlug: string;
  microdistrictName: string | null;
  /** «Работает сегодня до 20:00» / «Сегодня закрыто»; null — часы неизвестны. */
  openText: string | null;
  /** Параметры поиска — для учёта обращения. */
  scenario: LeadScenario;
  citySlug: string;
}) {
  const o = q.offer;
  const dep = depositLabel(o);
  const min = minTermLabel(o);
  const week = weekLabel(o);
  const Icon = groupIcon(groupSlug);

  return (
    <article
      className={cn(
        "relative grid rounded-lg bg-card shadow-card",
        "[grid-template-areas:'total'_'details'_'action']",
        "md:grid-cols-[240px_minmax(0,1fr)] md:[grid-template-areas:'total_details'_'action_details']",
      )}
    >
      <div className="flex flex-col gap-1.5 border-b-2 border-dashed border-border px-4 pb-3.5 pt-4 [grid-area:total] md:gap-2 md:border-b-0 md:border-r-2 md:px-[22px] md:pb-2.5 md:pt-5">
        {winnerLabel && <span className="text-xs font-bold text-cta">{winnerLabel}</span>}
        <span className="price text-[26px] leading-none md:text-[30px]">{formatRub(q.total)}</span>
        <span className={cn("text-xs leading-snug", q.minApplied ? "text-warn" : "text-muted-foreground")}>{quoteBreakdown(q)}</span>
      </div>

      <div className="flex min-w-0 gap-3 px-4 pt-3.5 [grid-area:details] md:px-[22px] md:py-5">
        {/* Чужие фото не копируем — пиктограмма группы. */}
        <span aria-hidden="true" className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-field bg-photo text-primary/70 sm:flex">
          <Icon className="h-7 w-7" strokeWidth={1.5} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold md:text-lg">
              <Link href={`/${citySlug}/prokaty/${o.shopSlug}` as never} className="hover:text-accent">
                {o.shopName}
              </Link>
            </h3>
            {o.claimed && <ClaimedBadge />}
          </div>
          <p className="text-sm text-muted-foreground">{o.modelName ?? o.model ?? "модель не указана"}</p>
          <p className="flex items-start gap-1.5 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              {q.trip && <span className="font-semibold">{tripLabel(q.trip)}</span>}
              {q.trip && " · "}
              <span className="text-muted-foreground">{placeText(o, microdistrictName)}</span>
            </span>
          </p>
          {openText && (
            <p className={cn("flex items-center gap-1.5 text-sm", openText.startsWith("Сегодня закрыто") ? "text-warn" : "text-ok")}>
              <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
              {openText}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn(chip, chipTone[dep.tone])}>{dep.text}</span>
            <span className={cn(chip, chipTone[min.tone])}>{min.text}</span>
            {week && o.priceDay != null && <span className={cn(chip, chipTone.normal)}>{week}</span>}
            {o.includes && <span className={cn(chip, chipTone.normal)}>В аренде: {o.includes}</span>}
          </div>
          {o.delivery.available && (
            <p className="text-[13px] text-muted-foreground">Есть доставка — уточняйте у проката</p>
          )}
          <p className="text-[13px] text-muted-foreground">Цена проверена {shortDate(o.verifiedAt)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pb-4 pt-3 [grid-area:action] md:border-r-2 md:border-dashed md:border-border md:px-[22px] md:pb-5 md:pt-0">
        <PhoneReveal offerId={o.id} winner={!!winnerLabel} tab={tab} rank={rank} scenario={scenario} />
        <OutdatedPrice offerId={o.id} />
      </div>

      {/* Вырезы «билета» на стыке частей — цвета фона страницы. */}
      <span aria-hidden="true" className="absolute left-[229px] top-[-1px] hidden h-[11px] w-[22px] rounded-b-full bg-background md:block" />
      <span aria-hidden="true" className="absolute bottom-[-1px] left-[229px] hidden h-[11px] w-[22px] rounded-t-full bg-background md:block" />
    </article>
  );
}
