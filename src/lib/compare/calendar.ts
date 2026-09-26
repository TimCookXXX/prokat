// Календарь «Когда»: сетка месяца и состояние дня. Даты — строки YYYY-MM-DD,
// считаем в UTC, чтобы часовой пояс браузера не сдвигал дни.

export const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;

export const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;

/** Месяц как «YYYY-MM». */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Недели месяца с понедельника; дни чужих месяцев — null. */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // пн = 0
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export type DayState = "none" | "single" | "start" | "end" | "middle";

/**
 * Как нарисовать день. Выбран только первый день — период до дня под курсором
 * показывается заранее (в любую сторону), как при бронировании.
 */
export function dayState(day: string, sel: { from: string | null; to: string | null }, hover: string | null): DayState {
  if (!sel.from) return "none";
  let from = sel.from;
  let to = sel.to ?? hover ?? sel.from;
  if (to < from) [from, to] = [to, from];
  if (from === to) return day === from ? "single" : "none";
  if (day === from) return "start";
  if (day === to) return "end";
  return day > from && day < to ? "middle" : "none";
}
