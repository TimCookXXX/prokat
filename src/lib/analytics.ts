// Цели Яндекс Метрики для учёта обращений. Серверная запись — lead_events
// (src/server/actions/leads.ts); здесь — то же событие для отчётов Метрики
// и оптимизации Директа. Без счётчика (dev, блокировщик) — тихо ничего.

export type Goal = "show_phone" | "request" | "regular_request" | "price_outdated" | "claim_click" | "map_open";

type Ym = (id: string, method: "reachGoal", goal: string, params?: Record<string, unknown>) => void;

export function reachGoal(goal: Goal, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { ym?: Ym; __ymCounterId?: string };
  if (!w.ym || !w.__ymCounterId) return;
  try {
    w.ym(w.__ymCounterId, "reachGoal", goal, params);
  } catch {
    // Метрика не должна ломать интерфейс.
  }
}
