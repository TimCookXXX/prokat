// Виды списка объявлений в кабинете: словарь и правило, что в какой попадает.
//
// Живёт в lib, а не рядом с компонентом фильтра, потому что читают это с двух
// сторон границы: страница разбирает `?view=` на сервере, чипы применяют вид в
// браузере. У модуля с "use client" клиентскими становятся ВСЕ экспорты, и
// серверный вызов такой функции падает в рантайме — типы этого не ловят.

export const LISTINGS_VIEWS = ["all", "active", "hidden", "archived"] as const;

export type ListingsView = (typeof LISTINGS_VIEWS)[number];

type ListingStatus = "active" | "hidden" | "archived";

/* «Все» — активные и скрытые, без архива: убранная вещь не возвращается в
 * список сама. Архив стоит рядом отдельным видом — он вне «Всех». */
export const LISTINGS_VIEW_MATCH: Record<ListingsView, (status: ListingStatus) => boolean> = {
  all: (s) => s !== "archived",
  active: (s) => s === "active",
  hidden: (s) => s === "hidden",
  archived: (s) => s === "archived",
};

export function isListingsView(value: unknown): value is ListingsView {
  return LISTINGS_VIEWS.includes(value as ListingsView);
}
