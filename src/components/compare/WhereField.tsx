"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GEOCODER_DEBOUNCE_MS } from "@/lib/compare/config";
import {
  CITY_LOCATION, locationLabel, matchPlaces, type CityGeo, type PlaceSuggestion, type UserLocation,
} from "@/lib/compare/geo";

interface AddressItem { title: string; subtitle: string | null; uri: string }

type Item =
  | { kind: "place"; place: PlaceSuggestion }
  | { kind: "address"; address: AddressItem }
  | { kind: "geo" };

// «Где» (ТЗ, п. 3.3): микрорайоны и округа — сразу из справочника; адреса — от
// геокодера через сервер с задержкой; «Определить моё местоположение» — геолокация
// браузера (отказ — без сообщения). Ввели и не выбрали — первая подсказка; подсказок
// нет — город и «Не нашли такой адрес — уточните». Пользователь всегда забирает сам.
export function WhereField({
  id, citySlug, cityName, geo, value, onChange, track, addressEnabled, list, labelClassName, valueClassName,
}: {
  /** Место определяется асинхронно (адрес, геолокация) — «Найти» ждёт этот промис. */
  track?: (pending: Promise<void>) => void;
  /** Стабильный id поля (см. WhatField). */
  id: string;
  citySlug: string;
  cityName: string;
  geo: CityGeo;
  value: UserLocation;
  onChange: (loc: UserLocation) => void;
  /** Есть ключи геокодера — подсказываем адреса. */
  addressEnabled: boolean;
  list: "popover" | "inline";
  labelClassName?: string;
  valueClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [addresses, setAddresses] = useState<AddressItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const picked = useRef(false);

  const label = value.kind === "city" ? "" : locationLabel(value, geo, cityName);
  const q = query ?? "";
  const typing = query !== null && q.trim().length >= 2 && q !== label;
  const places = useMemo(() => (typing ? matchPlaces(q, geo) : []), [typing, q, geo]);

  const fetchAddresses = async (text: string, signal?: AbortSignal): Promise<AddressItem[]> => {
    try {
      const res = await fetch(`/api/geo/suggest?city=${citySlug}&q=${encodeURIComponent(text)}`, { signal });
      return res.ok ? ((await res.json()) as { items: AddressItem[] }).items : [];
    } catch {
      return []; // сеть или отмена — без адресов
    }
  };

  // Адреса — с задержкой после ввода, чтобы не дёргать геокодер на каждую букву.
  // Старые подсказки сразу убираем: иначе под новым текстом висел бы чужой адрес.
  useEffect(() => {
    setAddresses([]);
    if (!addressEnabled || !typing || q.trim().length < 3) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const items = await fetchAddresses(q, ctl.signal);
      if (!ctl.signal.aborted) { setAddresses(items); setActive(-1); }
    }, GEOCODER_DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl.abort(); };
    // fetchAddresses зависит только от citySlug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressEnabled, typing, q, citySlug]);

  // Только на клиенте: на сервере navigator нет, а разметка должна совпасть при гидрации.
  const [canLocate, setCanLocate] = useState(false);
  useEffect(() => setCanLocate("geolocation" in navigator), []);
  const items: Item[] = [
    ...places.map((place) => ({ kind: "place" as const, place })),
    ...addresses.map((address) => ({ kind: "address" as const, address })),
    ...(canLocate ? [{ kind: "geo" as const }] : []),
  ];
  const open = query !== null && items.length > 0;

  const close = () => { picked.current = true; setQuery(null); setActive(-1); inputRef.current?.blur(); };

  const choose = async (item: Item): Promise<void> => {
    setNotice(null);
    close();
    if (item.kind === "place") {
      onChange(item.place.kind === "okrug"
        ? { kind: "okrug", okrug: item.place.slug }
        : { kind: "microdistrict", microdistrict: item.place.slug });
    } else if (item.kind === "address") {
      try {
        const res = await fetch(`/api/geo/resolve?uri=${encodeURIComponent(item.address.uri)}`);
        const point = res.ok ? ((await res.json()) as { point: { lat: number; lon: number } | null }).point : null;
        if (point) onChange({ kind: "point", point, label: item.address.title, source: "address" });
        else { onChange(CITY_LOCATION); setNotice("Не нашли такой адрес — уточните"); }
      } catch {
        setNotice("Не нашли такой адрес — уточните");
      }
    } else {
      setLocating(true);
      await new Promise<void>((resolve) => navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          onChange({ kind: "point", point: { lat: pos.coords.latitude, lon: pos.coords.longitude }, label: null, source: "geo" });
          resolve();
        },
        // Отказ или таймаут — без сообщения об ошибке: поле остаётся для ввода.
        () => { setLocating(false); resolve(); },
        { timeout: 10_000, maximumAge: 5 * 60_000 },
      ));
    }
  };

  /** Ввели и не выбрали: первый микрорайон или округ, иначе первый адрес (без ожидания задержки). */
  const resolveTyped = async (text: string): Promise<void> => {
    const place = matchPlaces(text, geo)[0];
    if (place) return choose({ kind: "place", place });
    const address = addressEnabled && text.length >= 3 ? (await fetchAddresses(text))[0] : undefined;
    if (address) return choose({ kind: "address", address });
    onChange(CITY_LOCATION);
    setNotice("Не нашли такой адрес — уточните");
  };

  const pick = (item: Item) => {
    const p = choose(item);
    track?.(p);
    return p;
  };

  const onBlur = () => {
    if (picked.current) { picked.current = false; return; }
    if (query === null) return;
    const text = q.trim();
    setQuery(null);
    setActive(-1);
    if (!text) { onChange(CITY_LOCATION); return; }
    if (!typing) return;
    track?.(resolveTyped(text));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter по набранному тексту без выбора: сначала определяем место, потом ищем.
    if (e.key === "Enter" && active < 0 && typing) {
      e.preventDefault();
      const form = inputRef.current?.form;
      const text = q.trim();
      picked.current = true;
      setQuery(null);
      const p = resolveTyped(text);
      track?.(p);
      void p.then(() => form?.requestSubmit());
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); void pick(items[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div className={cn(list === "popover" && "relative", "flex min-w-0 flex-col")}>
      <label htmlFor={`${id}-input`} className={labelClassName}>Где вы</label>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={locating ? "Определяем…" : `${cityName} — или район, адрес`}
          value={query ?? label}
          onFocus={(e) => { picked.current = false; setNotice(null); setQuery(label); setActive(-1); e.currentTarget.select(); }}
          onChange={(e) => { setQuery(e.target.value); setActive(-1); }}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className={cn(
            "w-full min-w-0 truncate bg-transparent font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground",
            valueClassName,
          )}
        />
        {(value.kind !== "city" || (query ?? "") !== "") && (
          <button
            type="button"
            aria-label="Сбросить — весь город"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(CITY_LOCATION); setQuery(query === null ? null : ""); setNotice(null); }}
            className="-my-2 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {notice && <span role="status" className="text-xs text-warn">{notice}</span>}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Где вы"
          className={cn(
            "flex flex-col py-1.5",
            list === "popover"
              ? "absolute inset-x-0 top-full z-40 mt-2 max-h-[min(70vh,440px)] overflow-y-auto rounded-lg border border-border bg-card shadow-card md:right-auto md:w-[min(420px,calc(100vw-32px))]"
              : "mt-1 border-t border-border",
          )}
        >
          {items.map((item, i) => (
            <li
              key={item.kind === "place" ? `p:${item.place.slug}` : item.kind === "address" ? `a:${item.address.uri}` : "geo"}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => void pick(item)}
              className={cn("flex min-h-[44px] cursor-pointer items-center gap-3 px-4 py-2", i === active && "bg-muted")}
            >
              {item.kind === "geo"
                ? <LocateFixed className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                : <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("line-clamp-2 text-[15px] leading-snug", item.kind === "geo" ? "font-semibold text-accent" : "text-foreground")}>
                  {item.kind === "place" ? item.place.title : item.kind === "address" ? item.address.title : "Определить моё местоположение"}
                </span>
                {item.kind !== "geo" && (
                  <span className="truncate text-[13px] text-muted-foreground">
                    {item.kind === "place" ? item.place.subtitle : item.address.subtitle ?? cityName}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
