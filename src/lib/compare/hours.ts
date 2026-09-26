// Часы работы проката: разбор строки из CSV и «работает сегодня» (ТЗ, пп. 5.4, 5.6).
//   «пн-пт 9:00-20:00; сб 10-16; вс выходной», «ежедневно 9-21», «круглосуточно».
// Нет дня в расписании — в этот день закрыто.

import type { WeekHours } from "@db/schema";

export type { WeekHours } from "@db/schema";

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const DAY_WORDS: Record<string, number> = { пн: 0, вт: 1, ср: 2, чт: 3, пт: 4, сб: 5, вс: 6 };

function time(t: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function days(spec: string): number[] | null {
  const s = spec.trim().toLowerCase();
  if (["ежедневно", "без выходных", "каждый день", "пн-вс"].includes(s)) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (const part of s.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [a, b] = part.split(/\s*[-–]\s*/);
    const from = DAY_WORDS[a];
    if (from === undefined) return null;
    if (b === undefined) { out.add(from); continue; }
    const to = DAY_WORDS[b];
    if (to === undefined) return null;
    for (let d = from; ; d = (d + 1) % 7) { out.add(d); if (d === to) break; }
  }
  return out.size ? [...out].sort() : null;
}

/** null — пусто; бросает Error с понятным текстом, если формат не узнан. */
export function parseHours(raw: string): WeekHours | null {
  const src = raw.trim().toLowerCase().replace(/ё/g, "е");
  if (!src) return null;
  if (["круглосуточно", "24/7", "24 часа"].includes(src)) {
    return Object.fromEntries(DAY_KEYS.map((k) => [k, [["00:00", "24:00"]]])) as WeekHours;
  }
  const out: WeekHours = {};
  for (const seg of src.split(";").map((x) => x.trim()).filter(Boolean)) {
    // «пн-пт 9:00-20:00», «сб,вс 10-16», «вс выходной», «ежедневно 9-21»
    const m = /^([а-я ,–-]+?)\s+(выходной|закрыто|\d.*)$/.exec(seg);
    const d = m ? days(m[1]) : null;
    if (!m || !d) throw new Error(`часы: «${seg}» — ожидается «пн-пт 9:00-20:00; сб 10-16; вс выходной»`);
    if (m[2] === "выходной" || m[2] === "закрыто") {
      for (const i of d) delete out[DAY_KEYS[i]];
      continue;
    }
    const intervals: [string, string][] = [];
    for (const iv of m[2].split(",").map((x) => x.trim())) {
      const [a, b] = iv.split(/\s*[-–]\s*/);
      const from = a ? time(a) : null;
      const to = b ? time(b) : null;
      if (!from || !to || from >= to) throw new Error(`часы: «${iv}» — интервал вида 9:00-20:00`);
      intervals.push([from, to]);
    }
    // По порядку: «до скольки сегодня» берётся из последнего интервала.
    intervals.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (const i of d) out[DAY_KEYS[i]] = intervals;
  }
  return out;
}

export interface OpenState {
  /** Сегодня есть часы работы и они ещё не закончились. */
  openToday: boolean;
  /** До скольки сегодня: «20:00»; null — закрыто или круглосуточно. */
  until: string | null;
  /** Круглосуточно сегодня. */
  allDay: boolean;
}

/**
 * Работает ли сегодня. `now` — местное время города: день недели (0 = пн) и «ЧЧ:ММ».
 * Сегодня закончил работу — считаем закрытым на сегодня.
 */
export function openState(hours: WeekHours | null, now: { weekday: number; time: string }): OpenState | null {
  if (!hours) return null;
  const today = hours[DAY_KEYS[now.weekday]] ?? [];
  const left = today.filter(([, to]) => to > now.time);
  if (left.length === 0) return { openToday: false, until: null, allDay: false };
  const last = left[left.length - 1][1];
  const allDay = today.length === 1 && today[0][0] === "00:00" && today[0][1] === "24:00";
  return { openToday: true, until: allDay ? null : last, allDay };
}

/** Местное время города (Краснодар — как Москва): день недели с пн = 0 и «ЧЧ:ММ». */
export function cityNow(date: Date = new Date(), timeZone = "Europe/Moscow"): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { weekday, time: `${get("hour")}:${get("minute")}` };
}

/** «Работает сегодня до 20:00», «Работает круглосуточно», «Сегодня закрыто»; null — часы неизвестны. */
export function openLabel(s: OpenState | null): string | null {
  if (!s) return null;
  if (!s.openToday) return "Сегодня закрыто";
  return s.allDay ? "Работает круглосуточно" : `Работает сегодня до ${s.until}`;
}
