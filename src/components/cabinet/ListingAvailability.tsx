"use client";

// Занятость вещи: настоящий месячный календарь, в котором даты закрывают
// кликом. Заменил самодельную сетку на 42 дня и форму с двумя полями `date`.
//
// Прежняя сетка календарём не была: она начиналась с сегодня и шла подряд, то
// есть колонки не соответствовали дням недели — оттого в каждой клетке и
// подписывался день. Показывала она в одном месте, а закрывали даты в другом,
// вслепую. Здесь и то и другое в одном месте, а недели стоят по колонкам.
//
// Библиотека та же, что у выбора дат при бронировании и у фильтра каталога, —
// второго вида календаря в проекте быть не должно.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DayPicker, type DateRange } from "react-day-picker";
import { ru } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { Button } from "@/components/ui/button";
import { field } from "@/components/ui/field";
import { setBlockedDates } from "@/server/actions/owner";
import type { DayLoad } from "@/lib/catalog/availability";
import { formatDayMonth } from "@/lib/catalog/dates";

function parse(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ListingAvailability({
  listingId, quantity, availability, today, maxDate,
}: {
  listingId: string;
  quantity: number;
  /** Занятость по дням на горизонт (plain object: Map не проходит границу RSC). */
  availability: Record<string, DayLoad>;
  today: string;
  maxDate: string;
}) {
  const [range, setRange] = useState<DateRange | undefined>();
  const [qty, setQty] = useState(quantity);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const load = useMemo(() => new Map(Object.entries(availability)), [availability]);

  // Бронь и ручное закрытие различаются намеренно: первое владелец снять не
  // может — за ним стоит подтверждённая заявка и человек с планами, — а второе
  // ставил он сам и снимает тем же кликом.
  const booked = (date: Date) => (load.get(fmt(date))?.bookedQty ?? 0) > 0;
  const blocked = (date: Date) => (load.get(fmt(date))?.blockedQty ?? 0) > 0;

  const run = (nextQty: number) => {
    if (!range?.from) return;
    setError(null);
    startTransition(async () => {
      const r = await setBlockedDates(listingId, fmt(range.from!), fmt(range.to ?? range.from!), nextQty);
      if (!r.ok) {
        setError(r.error === "range_too_long"
          ? "Слишком длинный диапазон — не больше года."
          : "Не получилось — обновите страницу.");
        return;
      }
      setRange(undefined);
      router.refresh();
    });
  };

  const picked = range?.from
    ? range.to && fmt(range.to) !== fmt(range.from)
      ? `${formatDayMonth(fmt(range.from))} — ${formatDayMonth(fmt(range.to))}`
      : formatDayMonth(fmt(range.from))
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="rdp-theme max-w-sm">
        <DayPicker
          locale={ru}
          mode="range"
          selected={range}
          onSelect={setRange}
          disabled={[{ before: parse(today) }, { after: parse(maxDate) }]}
          startMonth={parse(today)}
          endMonth={parse(maxDate)}
          today={parse(today)}
          weekStartsOn={1}
          showOutsideDays
          modifiers={{ booked, blocked }}
          modifiersClassNames={{ booked: "rdp-booked", blocked: "rdp-blocked" }}
        />
      </div>

      {/* Два состояния, а не три. Различать важно одно: бронь снять нельзя —
        * за ней подтверждённая заявка и человек с планами, — а своё закрытие
        * снимается тем же кликом. «Частично занято» имеет смысл лишь у вещей с
        * несколькими единицами, и ради него третий цвет не заводим.
        *
        * Бронь — охра: «в аренде» это состояние предмета. Красный по закону
        * цвета означает отмену и спор, занятость к ним не относится. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-accent/[0.12]" />
          бронь
        </span>
        <span className="flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block h-3 w-3 rounded-sm border border-dashed border-border bg-muted" />
          закрыто вами
        </span>
      </div>

      {picked ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-sm font-medium">{picked}</p>
          {quantity > 1 && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              Закрыть единиц
              <select
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                className={`${field} h-9 px-2 text-sm`}
              >
                {Array.from({ length: quantity }, (_, n) => n + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" pending={pending} onClick={() => run(qty)}>
              Закрыть даты
            </Button>
            <Button size="sm" variant="outline" pending={pending} onClick={() => run(0)}>
              Открыть
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setRange(undefined); setError(null); }}>
              Снять выбор
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Выберите дни в календаре, чтобы закрыть их («сдал по телефону», «в ремонте»)
          или открыть обратно. Дни под подтверждённой бронью так не снимаются.
        </p>
      )}
    </div>
  );
}
