"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  highlight, popularSuggestions, searchSuggestions, type SearchEntry, type Suggestion, type SuggestionKind,
} from "@/lib/compare/search";

const KIND_LABEL: Record<SuggestionKind, string | null> = { group: null, class: null, brand: "бренд", model: "модель" };

// «Что нужно» — строка с подсказками по мере набора (src/lib/compare/search.ts).
// Выбор подсказки заполняет поле и переводит фокус на «Когда»; ушли из поля,
// ничего не выбрав, — берём первую подсказку, иначе возвращаем прежний выбор.
// popover — список поверх страницы; inline — в потоке (внутри листа на телефоне,
// где абсолютный список обрезался бы прокруткой листа).
export function WhatField({
  index, label, onSelect, onPending, list, labelClassName, valueClassName,
}: {
  index: SearchEntry[];
  /** Что выбрано сейчас — текст поля вне фокуса. */
  label: string;
  onSelect: (s: Suggestion) => void;
  /** Первая подсказка набранного, пока ничего не выбрано: «Найти» возьмёт её. */
  onPending?: (s: Suggestion | null) => void;
  list: "popover" | "inline";
  labelClassName?: string;
  valueClassName?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null); // null — не редактируется
  const [active, setActive] = useState(0);
  // Выбор уже сделан — blur после него не должен подставлять первую подсказку.
  const picked = useRef(false);

  const q = query ?? "";
  const typing = query !== null && q.trim() !== "" && q !== label;
  const text = query ?? label;
  const results = useMemo(() => (typing ? searchSuggestions(index, q) : []), [index, q, typing]);
  const popular = useMemo(() => popularSuggestions(index, 6), [index]);
  const shown = typing ? (results.length ? results : popular) : popular;
  const open = query !== null && shown.length > 0;
  const top = typing ? results[0] ?? null : null;
  useEffect(() => { onPending?.(top); }, [top, onPending]);

  const pick = (s: Suggestion) => {
    onSelect(s);
    setQuery(null);
    picked.current = true;
    const when = inputRef.current?.form?.querySelector<HTMLElement>("[data-when]");
    inputRef.current?.blur();
    when?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % shown.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + shown.length) % shown.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(shown[active] ?? shown[0]); }
    else if (e.key === "Escape") { e.preventDefault(); picked.current = true; setQuery(null); inputRef.current?.blur(); }
  };

  const onBlur = () => {
    if (picked.current) { picked.current = false; return; }
    if (query === null) return;
    if (typing && results[0]) onSelect(results[0]);
    setQuery(null);
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  const options = (
    <ul
      id={listId}
      role="listbox"
      aria-label="Подсказки"
      className={cn(
        "flex flex-col py-1.5",
        list === "popover"
          ? "absolute inset-x-0 top-full z-40 mt-2 max-h-[min(70vh,480px)] overflow-y-auto rounded-lg border border-border bg-card shadow-card md:right-auto md:w-[min(520px,calc(100vw-32px))]"
          : "mt-1 border-t border-border",
      )}
    >
      {typing && results.length === 0 && (
        <li className="px-4 pb-2 pt-1.5 text-sm text-muted-foreground" role="presentation">
          Ничего не нашли по «{q.trim()}». Проверьте написание или выберите из популярного:
        </li>
      )}
      {!typing && (
        <li className="px-4 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" role="presentation">
          Популярное
        </li>
      )}
      {shown.map((s, i) => (
        <li
          key={s.key}
          id={optionId(i)}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(s)}
          className={cn(
            "flex min-h-[44px] cursor-pointer items-center gap-3 px-4 py-2 text-left",
            i === active && "bg-muted",
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="line-clamp-2 text-[15px] leading-snug text-foreground">
              {highlight(s.title, typing ? q : "").map((part, j) => (
                part.hit ? <b key={j} className="font-semibold">{part.text}</b> : <span key={j}>{part.text}</span>
              ))}
            </span>
            <span className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{s.subtitle}</span>
          </span>
          {KIND_LABEL[s.kind] && (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground max-sm:hidden">{KIND_LABEL[s.kind]}</span>
          )}
        </li>
      ))}
    </ul>
  );

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
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Перфоратор, болгарка, Makita…"
          value={text}
          onFocus={(e) => { picked.current = false; setQuery(label); setActive(0); e.currentTarget.select(); }}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className={cn(
            "w-full min-w-0 truncate bg-transparent font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground",
            valueClassName,
          )}
        />
        {query !== null && query !== "" && (
          <button
            type="button"
            aria-label="Очистить"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setQuery(""); setActive(0); inputRef.current?.focus(); }}
            className="-my-2 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && options}
    </div>
  );
}
