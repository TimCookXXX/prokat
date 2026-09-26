// Форматы сравнения по разделу «Тексты» дизайн-системы: даты «27 сен»,
// диапазон «сб 27 — пн 29 сен», сутки «2 суток», телефон «+7 918 123-45-67».

import { ruPlural } from "@/lib/plural";
import { dayOfMonth, weekdayShort } from "@/lib/catalog/dates";

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] as const;

function month(date: string): string {
  return MONTHS_SHORT[new Date(`${date}T00:00:00Z`).getUTCMonth()];
}

/** «18 сен» */
export function shortDate(date: string): string {
  return `${dayOfMonth(date)} ${month(date)}`;
}

/** «сб 27 — пн 29 сен»; месяцы разные — «вс 30 сен — вт 2 окт». */
export function dateRangeLabel(from: string, to: string): string {
  const left = `${weekdayShort(from)} ${dayOfMonth(from)}`;
  const right = `${weekdayShort(to)} ${dayOfMonth(to)} ${month(to)}`;
  if (from === to) return right;
  return month(from) === month(to) ? `${left} — ${right}` : `${left} ${month(from)} — ${right}`;
}

/** «1 сутки», «2 суток», «21 сутки». */
export function daysLabel(n: number): string {
  return `${n} ${ruPlural(n, "сутки", "суток", "суток")}`;
}

/** «прокат», «2 проката», «8 прокатов». */
export function shopsLabel(n: number): string {
  return `${n} ${ruPlural(n, "прокат", "проката", "прокатов")}`;
}

/** «у 1 проката», «у 2 прокатов» — после предлога «у». */
export function shopsGenitive(n: number): string {
  return `${n} ${ruPlural(n, "проката", "прокатов", "прокатов")}`;
}

/** +79181234567 → «+7 918 123-45-67»; нераспознанное — как есть. */
export function formatPhone(phone: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

/** Заголовок страницы сравнения: «Прокат перфоратора в Краснодаре». */
export function compareTitle(
  group: { seoWord: "prokat" | "arenda"; nameGenitive: string },
  city: { name: string; namePrepositional: string | null },
): string {
  const word = group.seoWord === "arenda" ? "Аренда" : "Прокат";
  return `${word} ${group.nameGenitive} в ${city.namePrepositional ?? city.name}`;
}
