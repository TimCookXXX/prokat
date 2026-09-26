"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDaysStr } from "@/lib/catalog/dates";
import { rentalDays } from "@/lib/compare/pricing";
import { DATE_HORIZON_DAYS, MAX_RENTAL_DAYS, pickRangeDay } from "@/lib/compare/scenario";
import { dateRangeLabel, daysLabel, shortDate } from "@/lib/compare/format";
import { WEEKDAYS, addMonths, dayState, monthGrid, monthOf, monthTitle } from "@/lib/compare/calendar";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/Modal";

/** Текст поля «Когда»: «сб 27 — пн 29 сен · 2 суток». */
export function whenLabel(from: string, to: string): string {
  return `${dateRangeLabel(from, to)} · ${daysLabel(rentalDays(from, to))}`;
}

// «Когда» — выбор периода, не счётчик дней: из дат считаем сутки. Первый клик —
// день получения (подсвечивается сразу), дальше под курсором виден будущий период;
// второй клик в любую сторону — период готов, календарь закрывается сам.
// Компьютер — два месяца рядом, телефон — один.
export function DateRangePicker({
  from, to, today, onDone,
}: {
  from: string | null;
  to: string | null;
  today: string;
  onDone: (from: string, to: string) => void;
}) {
  const [sel, setSel] = useState<{ from: string | null; to: string | null }>({ from, to });
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth] = useState(monthOf(from ?? today));
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closing.current) clearTimeout(closing.current); }, []);

  const lastStart = addDaysStr(today, DATE_HORIZON_DAYS);
  const lastDay = addDaysStr(lastStart, MAX_RENTAL_DAYS);
  const awaitingEnd = !!sel.from && !sel.to;
  const disabled = (d: string) => {
    if (d < today || d > lastDay) return true;
    if (!awaitingEnd) return d > lastStart;
    const [a, b] = d < sel.from! ? [d, sel.from!] : [sel.from!, d];
    return rentalDays(a, b) > MAX_RENTAL_DAYS || a > lastStart;
  };

  const pick = (d: string) => {
    const next = pickRangeDay(sel, d);
    setSel(next);
    setHover(null);
    if (next.to) {
      const to = next.to;
      // Короткая пауза — увидеть выбранный период перед закрытием.
      closing.current = setTimeout(() => onDone(next.from, to), 220);
    }
  };

  const preview = awaitingEnd && hover && !disabled(hover)
    ? (hover < sel.from! ? [hover, sel.from!] : [sel.from!, hover])
    : null;
  const status = sel.from && sel.to
    ? whenLabel(sel.from, sel.to)
    : preview
      ? whenLabel(preview[0], preview[1])
      : awaitingEnd
        ? `Забираете ${shortDate(sel.from!)} — выберите день возврата`
        : "Выберите день, когда заберёте";

  const canPrev = month > monthOf(today);
  const canNext = addMonths(month, 1) < monthOf(lastDay);

  const renderMonth = (m: string, extra?: string) => (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-2", extra)}>
      <div className="flex h-9 items-center justify-center text-base font-semibold">{monthTitle(m)}</div>
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((w) => <span key={w} className="py-1">{w}</span>)}
      </div>
      <div role="grid" aria-label={monthTitle(m)} className="flex flex-col">
        {monthGrid(m).map((week, wi) => (
          <div role="row" key={wi} className="grid grid-cols-7">
            {week.map((d, di) => {
              if (!d) return <span key={di} role="gridcell" />;
              const st = dayState(d, sel, awaitingEnd && hover && !disabled(hover) ? hover : null);
              const off = disabled(d);
              const end = st === "start" || st === "end" || st === "single";
              return (
                <span key={d} role="gridcell" className="relative flex h-11 items-center justify-center">
                  {st === "middle" && <span aria-hidden="true" className="absolute inset-x-0 inset-y-0.5 bg-muted" />}
                  {st === "start" && <span aria-hidden="true" className="absolute inset-y-0.5 left-1/2 right-0 bg-muted" />}
                  {st === "end" && <span aria-hidden="true" className="absolute inset-y-0.5 left-0 right-1/2 bg-muted" />}
                  <button
                    type="button"
                    disabled={off}
                    aria-pressed={end}
                    aria-label={`${shortDate(d)}${d === today ? ", сегодня" : ""}`}
                    onClick={() => pick(d)}
                    onMouseEnter={() => awaitingEnd && setHover(d)}
                    onFocus={() => awaitingEnd && setHover(d)}
                    className={cn(
                      "relative z-10 flex h-10 w-10 flex-col items-center justify-center rounded-full text-[15px] tabular-nums transition-colors",
                      end ? "bg-primary font-semibold text-primary-foreground"
                        : off ? "cursor-default text-muted-foreground opacity-40"
                          : "hover:bg-muted",
                    )}
                  >
                    {Number(d.slice(8))}
                    {d === today && (
                      <span aria-hidden="true" className={cn("absolute bottom-1 h-1 w-1 rounded-full", end ? "bg-primary-foreground" : "bg-accent")} />
                    )}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3" onMouseLeave={() => setHover(null)}>
      <div className="relative">
        <button
          type="button"
          aria-label="Предыдущий месяц"
          disabled={!canPrev}
          onClick={() => setMonth(addMonths(month, -1))}
          className="absolute left-0 top-0 z-20 grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Следующий месяц"
          disabled={!canNext}
          onClick={() => setMonth(addMonths(month, 1))}
          className="absolute right-0 top-0 z-20 grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="flex gap-8">
          {renderMonth(month)}
          {renderMonth(addMonths(month, 1), "max-md:hidden")}
        </div>
      </div>
      <p className="min-h-[20px] text-center text-sm font-semibold" aria-live="polite">{status}</p>
    </div>
  );
}

/** Поле «Когда» в строке поиска: показывает диапазон, открывает календарь. */
export function DateRangeField({
  from, to, today, onChange, labelClassName, valueClassName, className,
}: {
  from: string | null;
  to: string | null;
  today: string;
  onChange: (from: string, to: string) => void;
  labelClassName?: string;
  valueClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen}>
      <button type="button" data-when onClick={() => setOpen(true)} className={cn("flex min-w-0 flex-col text-left", className)}>
        <span className={labelClassName}>Когда</span>
        {from && to
          ? <span className={cn("truncate", valueClassName)}>{whenLabel(from, to)}</span>
          : <span className={cn("truncate", valueClassName, "font-normal text-muted-foreground")}>Даты аренды</span>}
      </button>
      <ModalContent className="md:max-w-[680px]">
        <ModalTitle className="mb-2 font-display text-lg font-semibold">Когда нужен</ModalTitle>
        <DateRangePicker
          from={from}
          to={to}
          today={today}
          onDone={(f, t) => { onChange(f, t); setOpen(false); }}
        />
      </ModalContent>
    </Modal>
  );
}
