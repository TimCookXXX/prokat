"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emptyParams, patchParams, resultHref, targetHref, type ResultParams,
} from "@/lib/compare/scenario";
import { dateRangeLabel } from "@/lib/compare/format";
import { buildSearchIndex, type SearchData } from "@/lib/compare/search";
import { locationLabel, parseLocation, locationQuery, type CityGeo, type UserLocation } from "@/lib/compare/geo";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { DateRangeField } from "./DateRangeField";
import { WhatField, type WhatValue } from "./WhatField";
import { WhereField } from "./WhereField";

export type SearchBarData = SearchData & { seoWords: Record<string, string> };

/** Выбор в строке поиска; пустые поля на главной. */
export interface SearchValue {
  what: WhatValue;
  from: string | null;
  to: string | null;
  loc: UserLocation;
}

// Последнее выбранное «Где» — на устройстве (ТЗ, п. 3.3). Только удобство: нет
// хранилища (приватный режим) — просто не помним.
const LOC_KEY = "inr_loc";

function readStoredLocation(geo: CityGeo): UserLocation | null {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    if (!raw) return null;
    const loc = parseLocation(JSON.parse(raw) as Record<string, string>, geo);
    return loc.kind === "city" ? null : loc;
  } catch {
    return null;
  }
}

function storeLocation(loc: UserLocation) {
  try {
    if (loc.kind === "city") localStorage.removeItem(LOC_KEY);
    else localStorage.setItem(LOC_KEY, JSON.stringify(locationQuery(loc)));
  } catch { /* нет хранилища — не помним */ }
}

const MD_GROW: Record<string, string> = {
  "flex-[1.4]": "md:flex-[1.4]",
  "flex-1": "md:flex-1",
};

// Строка поиска «Что · Когда · Где» (ТЗ, пп. 3, 6). hero — большая на главной;
// compact — на выдаче с текущим выбором, на телефоне сворачивается в строку
// «Puzzi 8/1 · 27–29 сен · ЮМР» с карандашом. Даты не выбраны — сегодня на 1 сутки.
export function SearchBar({
  citySlug, cityName, search, geo, addressEnabled, value, today, variant,
}: {
  citySlug: string;
  cityName: string;
  search: SearchBarData;
  geo: CityGeo;
  addressEnabled: boolean;
  value: SearchValue;
  today: string;
  variant: "hero" | "compact";
}) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [sheet, setSheet] = useState(false);
  const index = useMemo(() => buildSearchIndex(search), [search]);
  const hero = variant === "hero";

  // Место может прийти позже клика «Найти» (адрес, геолокация): submit ждёт промис
  // и берёт место из ref — состояние к этому моменту ещё не перерисовано.
  const locRef = useRef<UserLocation>(value.loc);
  const pendingLoc = useRef<Promise<void> | null>(null);
  const track = (p: Promise<void>) => {
    pendingLoc.current = p;
    void p.finally(() => { if (pendingLoc.current === p) pendingLoc.current = null; });
  };
  const setLoc = (loc: UserLocation) => {
    storeLocation(loc);
    locRef.current = loc;
    setV((x) => ({ ...x, loc }));
  };

  // На главной подставляем последнее место с этого устройства.
  useEffect(() => {
    if (!hero || value.loc.kind !== "city") return;
    const stored = readStoredLocation(geo);
    if (stored) { locRef.current = stored; setV((x) => ({ ...x, loc: stored })); }
  }, [hero, value.loc.kind, geo]);

  const submit = async (form: HTMLFormElement) => {
    if (pendingLoc.current) await pendingLoc.current;
    let p: ResultParams = { ...emptyParams(today), loc: locRef.current };
    if (v.from && v.to) p = patchParams(p, { from: v.from, to: v.to });
    if (v.what.target) {
      setSheet(false);
      router.push(targetHref(citySlug, v.what.target, search.seoWords, p) as never);
      return;
    }
    const text = v.what.label.trim();
    if (!text) {
      // Не сказали, что нужно, — открываем подсказки вместо пустого поиска.
      form.querySelector<HTMLInputElement>("input[role=combobox]")?.focus();
      return;
    }
    setSheet(false);
    router.push(resultHref(`/${citySlug}/poisk?q=${encodeURIComponent(text)}`, p) as never);
  };
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); void submit(e.currentTarget); };

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
      <div className={cn(cell, place(layout, "flex-[1.4]"))}>
        <WhatField
          id={`what-${variant}-${layout}`}
          index={index}
          value={v.what}
          onChange={(what) => setV((x) => ({ ...x, what }))}
          list={layout === "column" ? "inline" : "popover"}
          labelClassName={labelCls}
          valueClassName={valueCls}
        />
      </div>
      <div className={cn(cell, place(layout, "flex-1"))}>
        <DateRangeField
          from={v.from}
          to={v.to}
          today={today}
          onChange={(from, to) => setV((x) => ({ ...x, from, to }))}
          labelClassName={labelCls}
          valueClassName={cn("font-semibold", valueCls)}
        />
      </div>
      <div className={cn(cell, place(layout, "flex-1", true))}>
        <WhereField
          id={`where-${variant}-${layout}`}
          citySlug={citySlug}
          cityName={cityName}
          geo={geo}
          value={v.loc}
          onChange={setLoc}
          track={track}
          addressEnabled={addressEnabled}
          list={layout === "column" ? "inline" : "popover"}
          labelClassName={labelCls}
          valueClassName={valueCls}
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

  const where = v.loc.kind === "city" ? cityName : locationLabel(v.loc, geo, cityName);
  return (
    <>
      {/* Десктоп: одна плашка с полями. */}
      <form onSubmit={onSubmit} className="hidden items-stretch rounded-tabs bg-card p-1.5 text-foreground md:flex">
        {fields("row")}
        {findBtn(false)}
      </form>

      {/* Телефон: «Puzzi 8/1 · 27–29 сен · ЮМР», по нажатию — форма в листе. */}
      <Modal open={sheet} onOpenChange={setSheet}>
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="flex w-full items-center gap-2.5 rounded-field bg-card px-3.5 py-2.5 text-left text-foreground md:hidden"
        >
          <span className="min-w-0 flex-1 truncate text-[15px]">
            <b className="font-semibold">{v.what.label || "Что нужно"}</b>
            <span className="text-muted-foreground">
              {" · "}{v.from && v.to ? dateRangeLabel(v.from, v.to) : "сегодня"}{" · "}{where}
            </span>
          </span>
          <Pencil className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Изменить параметры</span>
        </button>
        <ModalContent className="md:max-w-md">
          <ModalTitle className="mb-3 font-display text-lg font-semibold">Что, когда, где</ModalTitle>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col rounded-field border border-border">{fields("column")}</div>
            {findBtn(true)}
          </form>
        </ModalContent>
      </Modal>
    </>
  );
}

