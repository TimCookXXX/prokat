"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { compareHref, defaultDates, type CompareParams } from "@/lib/compare/scenario";
import { dateRangeLabel } from "@/lib/compare/format";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { buildSearchIndex, type SearchGroupInput, type SearchModelInput, type Suggestion } from "@/lib/compare/search";
import { DateRangeField } from "./DateRangeField";
import { WhatField } from "./WhatField";

/** Что ищем в городе: группы с классами и синонимами, модели с предложениями. */
export interface SearchData {
  groups: SearchGroupInput[];
  models: SearchModelInput[];
}

/** Выбор в строке поиска; пустые поля на главной — null. */
export interface SearchValue {
  groupSlug: string | null;
  classSlug: string | null;
  /** Модель или бренд из подсказки — фильтр выдачи `m`. */
  model?: string | null;
  from: string | null;
  to: string | null;
  /** Страница сравнения: сохранить «заберу сам» при новом поиске. */
  pickup?: boolean;
}

// Классы пишем целиком: Tailwind собирает только то, что видит в исходниках.
const MD_GROW: Record<string, string> = {
  "flex-[1.6]": "md:flex-[1.6]",
  "flex-1": "md:flex-1",
};

// Строка поиска «Что нужно · Когда» (DESIGN_SYSTEM → SearchBar). hero — большая
// на главной, поля пустые с подсказками; compact — на странице сравнения с
// текущим выбором, на телефоне сворачивается в строку-кнопку с карандашом.
// Даты не выбраны — ищем на завтра, 1 сутки.
export function SearchBar({
  citySlug, search, value, today, variant,
}: {
  citySlug: string;
  search: SearchData;
  value: SearchValue;
  today: string;
  variant: "hero" | "compact";
}) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [sheet, setSheet] = useState(false);

  const pending = useRef<Suggestion | null>(null);
  const setPending = useMemo(() => (s: Suggestion | null) => { pending.current = s; }, []);
  const index = useMemo(() => buildSearchIndex(search.groups, search.models), [search]);
  const classes = useMemo(
    () => search.groups.flatMap((g) => g.classes.map((cl) => ({ ...cl, group: g.slug }))),
    [search],
  );
  const current = classes.find((c) => c.slug === v.classSlug && c.group === v.groupSlug);
  // Текст поля — заголовок подсказки, которой соответствует выбор; ничего не выбрано — пусто.
  const label = useMemo(() => {
    if (!current) return "";
    const model = v.model ?? null;
    const hit = index.find(({ suggestion: s }) => s.model === model && s.classSlug === current.slug && s.kind !== "group")
      ?? index.find(({ suggestion: s }) => !model && s.kind === "group" && s.groupSlug === current.group);
    return hit?.suggestion.title ?? model ?? current.name;
  }, [index, v.model, current]);

  const submit = (form: HTMLFormElement) => {
    const s = pending.current;
    const next = s ? { ...v, groupSlug: s.groupSlug, classSlug: s.classSlug, model: s.model } : v;
    const cls = classes.find((c) => c.slug === next.classSlug && c.group === next.groupSlug);
    if (!cls) {
      // Не выбрали, что нужно, — открываем подсказки вместо пустого поиска.
      form.querySelector<HTMLInputElement>("input[role=combobox]")?.focus();
      return;
    }
    const dates = next.from && next.to ? { from: next.from, to: next.to } : defaultDates(today);
    const params: CompareParams = {
      classSlug: cls.slug,
      model: next.model ?? null,
      ...dates,
      days: 0,
      pickup: !!next.pickup,
      tab: "cheapest",
      filters: { noMoneyDeposit: false, sameDay: false, claimed: false, oneDay: false, areas: [] },
    };
    setSheet(false);
    router.push(compareHref(citySlug, cls.group, params) as never);
  };
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); submit(e.currentTarget); };

  const hero = variant === "hero";
  const labelCls = cn("text-muted-foreground", hero ? "text-xs" : "text-[11px]");
  const valueCls = hero ? "text-[17px] md:text-[19px]" : "text-base";
  const cell = cn("relative flex min-w-0 flex-col gap-0.5", hero ? "px-[18px] py-2.5" : "px-4 py-1.5");

  // row — плашка в строку; column — столбец (лист на телефоне); auto — столбец
  // на телефоне и строка с md (большой поиск на главной).
  const place = (layout: "row" | "column" | "auto", grow: string, last = false) => {
    const row = cn(grow, "basis-0", !last && "border-r border-border");
    const col = !last && "border-b border-border";
    if (layout === "row") return row;
    if (layout === "column") return col;
    return cn(col, "md:border-b-0", MD_GROW[grow], "md:basis-0", !last && "md:border-r");
  };

  const fields = (layout: "row" | "column" | "auto") => (
    <>
      <div className={cn(cell, place(layout, "flex-[1.6]"))}>
        <WhatField
          index={index}
          label={label}
          list={layout === "column" ? "inline" : "popover"}
          onSelect={(s) => setV({ ...v, groupSlug: s.groupSlug, classSlug: s.classSlug, model: s.model })}
          onPending={setPending}
          labelClassName={labelCls}
          valueClassName={valueCls}
        />
      </div>
      <div className={cn(cell, place(layout, "flex-1", true))}>
        <DateRangeField
          from={v.from}
          to={v.to}
          today={today}
          onChange={(from, to) => setV({ ...v, from, to })}
          labelClassName={labelCls}
          valueClassName={cn("font-semibold", valueCls)}
        />
      </div>
    </>
  );

  const findBtn = (full: boolean) => (
    <Button
      type="submit"
      variant="cta"
      className={cn(
        "shrink-0",
        hero ? "h-auto min-h-[52px] w-full rounded-field px-[34px] text-lg md:w-auto" : "h-auto min-h-[44px] px-7 text-base",
        full && "w-full",
      )}
    >
      Найти
    </Button>
  );

  if (hero) {
    return (
      <form
        onSubmit={onSubmit}
        className="flex flex-col rounded-hero bg-card p-2 text-foreground shadow-hero-search md:flex-row md:items-stretch"
      >
        <div className="flex flex-col md:contents">{fields("auto")}</div>
        <div className="p-1 md:p-0">{findBtn(false)}</div>
      </form>
    );
  }

  return (
    <>
      {/* Десктоп: одна плашка с полями. */}
      <form onSubmit={onSubmit} className="hidden items-stretch rounded-tabs bg-card p-1.5 text-foreground md:flex">
        {fields("row")}
        {findBtn(false)}
      </form>

      {/* Телефон: параметры одной строкой, по нажатию — форма в листе. */}
      <Modal open={sheet} onOpenChange={setSheet}>
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="flex w-full items-center gap-2.5 rounded-field bg-card px-3.5 py-2.5 text-left text-foreground md:hidden"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold">{label || "Что нужно"}</span>
            <span className="truncate text-[13px] text-muted-foreground">
              {v.from && v.to ? dateRangeLabel(v.from, v.to) : "даты не выбраны"} · {v.pickup ? "заберу сам" : "с доставкой"}
            </span>
          </span>
          <Pencil className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Изменить параметры</span>
        </button>
        <ModalContent className="md:max-w-md">
          <ModalTitle className="mb-3 font-display text-lg font-semibold">Что и когда</ModalTitle>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col rounded-field border border-border">{fields("column")}</div>
            {findBtn(true)}
          </form>
        </ModalContent>
      </Modal>
    </>
  );
}
