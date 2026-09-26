"use client";

import { useMemo, useRef, useState } from "react";
import { Package, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  highlight, popularSuggestions, searchSuggestions, type SearchEntry, type SearchTarget, type Suggestion,
} from "@/lib/compare/search";

/** Что в поле: текст и, если выбрана подсказка, куда она ведёт. */
export interface WhatValue {
  label: string;
  target: SearchTarget | null;
}

// «Что нужно» (ТЗ, п. 3.1): строка с подсказками — модели и классы по 5 штук с
// числом прокатов. Выбор подсказки задаёт цель поиска и переводит фокус на «Когда».
// Текст без выбора — это запрос: «Найти» отдаст его серверу, тот определит уровень
// (модель, бренд, класс, неоднозначно, не найдено). Enter без выделенной подсказки
// отправляет форму. popover — список поверх страницы; inline — в потоке (в листе
// на телефоне, где абсолютный список обрезался бы прокруткой листа).
export function WhatField({
  id, index, value, onChange, list, labelClassName, valueClassName,
}: {
  /** Стабильный id поля (не useId: строка поиска бывает в двух местах, id должны совпасть при гидрации). */
  id: string;
  index: SearchEntry[];
  value: WhatValue;
  onChange: (v: WhatValue) => void;
  list: "popover" | "inline";
  labelClassName?: string;
  valueClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const q = value.label;
  const typing = q.trim() !== "" && value.target === null;
  const results = useMemo(() => (typing ? searchSuggestions(index, q) : null), [index, q, typing]);
  const popular = useMemo(() => popularSuggestions(index, 6), [index]);
  const sections: { title: string; items: Suggestion[] }[] = results
    ? [
      { title: "Модели", items: results.models },
      { title: "Классы", items: results.classes },
    ].filter((s) => s.items.length)
    : [{ title: "Популярное", items: popular }];
  const flat = sections.flatMap((s) => s.items);
  const showList = open && (flat.length > 0 || typing);

  const pick = (s: Suggestion) => {
    onChange({ label: s.title, target: s.target });
    setOpen(false);
    setActive(-1);
    const when = inputRef.current?.form?.querySelector<HTMLElement>("[data-when]");
    inputRef.current?.blur();
    when?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % flat.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? flat.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0 && flat[active]) { e.preventDefault(); pick(flat[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setActive(-1); }
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  let n = -1;

  return (
    <div className={cn(list === "popover" && "relative", "flex min-w-0 flex-col")}>
      <label htmlFor={`${id}-input`} className={labelClassName}>Что нужно</label>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Перфоратор, Karcher Puzzi, болгарка…"
          value={q}
          onFocus={(e) => { setOpen(true); setActive(-1); e.currentTarget.select(); }}
          onBlur={() => setOpen(false)}
          onChange={(e) => { onChange({ label: e.target.value, target: null }); setOpen(true); setActive(-1); }}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full min-w-0 truncate bg-transparent font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground",
            valueClassName,
          )}
        />
        {q !== "" && (
          <button
            type="button"
            aria-label="Очистить"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange({ label: "", target: null }); setOpen(true); inputRef.current?.focus(); }}
            className="-my-2 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Подсказки"
          className={cn(
            "flex flex-col py-1.5",
            list === "popover"
              ? "absolute inset-x-0 top-full z-40 mt-2 max-h-[min(70vh,520px)] overflow-y-auto rounded-lg border border-border bg-card shadow-card md:right-auto md:w-[min(560px,calc(100vw-32px))]"
              : "mt-1 border-t border-border",
          )}
        >
          {typing && flat.length === 0 && (
            <p className="px-4 py-2 text-sm text-muted-foreground">
              Точных подсказок нет — нажмите «Найти», поищем «{q.trim()}» по всем прокатам.
            </p>
          )}
          {sections.map((sec) => (
            <div key={sec.title} role="group" aria-label={sec.title}>
              <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{sec.title}</p>
              {sec.items.map((s) => {
                n++;
                const i = n;
                const Icon = s.kind === "model" ? Package : Search;
                return (
                  <div
                    key={s.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(s)}
                    className={cn("flex min-h-[44px] cursor-pointer items-center gap-3 px-4 py-2 text-left", i === active && "bg-muted")}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="line-clamp-2 text-[15px] leading-snug text-foreground">
                        {highlight(s.title, typing ? q : "").map((part, j) => (
                          part.hit ? <b key={j} className="font-semibold">{part.text}</b> : <span key={j}>{part.text}</span>
                        ))}
                      </span>
                      <span className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{s.subtitle}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
