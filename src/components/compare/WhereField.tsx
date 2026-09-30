"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GEOCODER_DEBOUNCE_MS } from "@/lib/compare/config";
import {
  CITY_LOCATION, locationLabel, matchPlaces, type CityGeo, type GeoPoint, type PlaceSuggestion, type UserLocation,
} from "@/lib/compare/geo";
import {
  hasHouseNumber, hitPrecision, hitToLocation, needsServer, precisionNote, reverseLabel, shouldApply,
  visibleAddresses, withoutPlaceDuplicates, type AddressHit, type SuggestReply,
} from "@/lib/compare/address";
import { fetchAddressHits, fetchReverse, loadClientGeocoder, type ClientSuggester } from "./address-client";

type Item =
  | { kind: "place"; place: PlaceSuggestion }
  | { kind: "address"; address: AddressHit }
  | { kind: "geo" };

const ADDRESS_LIMIT = 7;

// «Где» (ТЗ, п. 3.3): микрорайоны и округа — сразу из справочника; адреса — свой геокодер
// (OSM + ГАР, без внешних сервисов): улицы, посёлки и микрорайоны — мгновенно из мини-индекса
// в браузере (грузится при фокусе и собирается в Web Worker, ввод не подвисает), дома — с сервера
// через ~90 мс после ввода. Подсказка
// сразу несёт координаты и точность: адрес не до дома — с «≈». «Определить моё
// местоположение» — геолокация браузера (отказ — без сообщения) и подпись адреса по точке.
// Ввели и не выбрали — первая подсказка; подсказок нет — город и «Не нашли такой адрес —
// уточните». Пользователь всегда забирает сам.
export function WhereField({
  id, citySlug, cityName, geo, value, onChange, track, addressIndex, list, labelClassName, valueClassName,
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
  /** Метка версии адресов города (src/server/geocoder.ts); null — адресов нет, только места. */
  addressIndex: string | null;
  list: "popover" | "inline";
  labelClassName?: string;
  valueClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [client, setClient] = useState<ClientSuggester | null>(null);
  // Последний ответ мини-индекса: держится, пока не пришёл ответ на новый текст (без мигания).
  const [clientReply, setClientReply] = useState<AddressHit[] | null>(null);
  const [server, setServer] = useState<SuggestReply | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "warn" | "info" } | null>(null);
  const [locating, setLocating] = useState(false);
  const picked = useRef(false);
  const seq = useRef(0);
  const shownSeq = useRef(0);

  const label = value.kind === "city" ? "" : locationLabel(value, geo, cityName);
  const q = query ?? "";
  const qRef = useRef(q);
  qRef.current = q;
  const typing = query !== null && q.trim().length >= 2 && q !== label;
  const places = useMemo(() => (typing ? matchPlaces(q, geo) : []), [typing, q, geo]);
  const knownPlaces = useMemo(
    () => [...geo.microdistricts.map((m) => m.name), ...geo.okrugs.map((o) => o.name)],
    [geo],
  );
  // Рядом с прошлым выбором одноимённые улицы выше («Вишнёвая» в своём СНТ).
  const near: GeoPoint | null = useMemo(() => {
    if (value.kind === "point") return value.point;
    if (value.kind === "microdistrict") return geo.microdistricts.find((m) => m.slug === value.microdistrict) ?? null;
    return null;
  }, [value, geo]);

  // Мини-индекс — один раз, при первом фокусе поля.
  const loadClient = () => {
    if (!addressIndex || client) return;
    void loadClientGeocoder(citySlug, addressIndex).then((g) => { if (g) setClient(g); });
  };

  // Улицы, пункты, объекты — из мини-индекса, на каждое нажатие (в воркере: доли миллисекунды и
  // пересылка). Ответ на уже изменённый текст отбрасывается; воркер упал (null) — только сервер.
  useEffect(() => {
    if (!client || !typing) return;
    let live = true;
    void client.suggest(q, { limit: ADDRESS_LIMIT, near }).then((items) => {
      if (!live) return;
      if (items === null) {
        setClient(null);
        setClientReply(null);
      } else setClientReply(items);
    });
    return () => { live = false; };
  }, [client, typing, q, near]);
  const clientHits = client && typing ? clientReply : null;

  // Дома — с сервера, с короткой задержкой. Запрос в полёте не отменяем (AbortController), а
  // сверяем его ответ: отмена отклоняет промисы fetch, и обёртки fetch (расширения браузера)
  // выдают это как необработанную ошибку «signal is aborted without reason». Устаревший ответ
  // (пришёл позже более нового или на текст, который уже стёрли) отбрасывается.
  useEffect(() => {
    if (!addressIndex || !typing || !needsServer(q, !!client)) return;
    const t = setTimeout(async () => {
      const mine = ++seq.current;
      const items = await fetchAddressHits(citySlug, q.trim(), near);
      if (items && shouldApply({ seq: mine, q }, shownSeq.current, qRef.current)) {
        shownSeq.current = mine;
        setServer({ seq: mine, q: q.trim(), items });
        setActive(-1);
      }
    }, GEOCODER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [addressIndex, typing, q, client, citySlug, near]);

  const addresses = typing
    ? withoutPlaceDuplicates(visibleAddresses(q, server, clientHits), knownPlaces).slice(0, ADDRESS_LIMIT)
    : [];

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
      // Координаты уже в подсказке — второго запроса нет.
      const loc = hitToLocation(item.address, cityName);
      onChange(loc);
      if (loc.precision) {
        setNotice({
          tone: "info",
          text: loc.precision === "street"
            ? (hasHouseNumber(item.address.title) ? "Дома нет в адресной базе — расстояния от улицы, ≈" : "Расстояния — от улицы, ≈")
            : "Расстояния — от центра населённого пункта, ≈",
        });
      }
    } else {
      setLocating(true);
      const point = await new Promise<GeoPoint | null>((resolve) => navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        // Отказ или таймаут — без сообщения об ошибке: поле остаётся для ввода.
        () => resolve(null),
        { timeout: 10_000, maximumAge: 5 * 60_000 },
      ));
      // Подпись точки — адрес рядом («улица Красная, 162Б»); не успел — «Моё местоположение».
      const hit = point && addressIndex ? await fetchReverse(citySlug, point) : null;
      setLocating(false);
      if (point) onChange({ kind: "point", point, label: reverseLabel(hit, cityName), source: "geo" });
    }
  };

  /** Ввели и не выбрали: первый микрорайон или округ, иначе первый адрес (без ожидания задержки). */
  const resolveTyped = async (text: string): Promise<void> => {
    const place = matchPlaces(text, geo)[0];
    if (place) return choose({ kind: "place", place });
    let address: AddressHit | undefined;
    let failed = false;
    if (addressIndex) {
      if (server && server.q.toLowerCase() === text.toLowerCase()) address = server.items[0];
      else {
        const local = client && !hasHouseNumber(text) ? await client.suggest(text, { limit: 1, near }) : null;
        if (local) address = local[0];
        else {
          const found = await fetchAddressHits(citySlug, text, near);
          failed = found === null;
          // Сервер не ответил — хотя бы улица из мини-индекса.
          address = found?.[0] ?? (client ? (await client.suggest(text, { limit: 1, near }))?.[0] : undefined);
        }
      }
    }
    if (address) return choose({ kind: "address", address });
    onChange(CITY_LOCATION);
    setNotice({
      tone: "warn",
      text: failed
        ? "Не получилось определить адрес — попробуйте ещё раз или выберите микрорайон"
        : "Не нашли такой адрес — уточните",
    });
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
          onFocus={(e) => {
            picked.current = false; setNotice(null); setServer(null); setClientReply(null); setQuery(label); setActive(-1);
            e.currentTarget.select(); loadClient();
          }}
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
      {notice && (
        <span role="status" className={cn("text-xs", notice.tone === "warn" ? "text-warn" : "text-muted-foreground")}>
          {notice.text}
        </span>
      )}
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
              key={item.kind === "place" ? `p:${item.place.slug}` : item.kind === "address" ? `a:${item.address.id}` : "geo"}
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
                    {item.kind === "place" ? item.place.subtitle : addressSubtitle(item.address, cityName)}
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

/** Вторая строка адреса: «Яблоновский» / «Краснодар, Юбилейный» и «≈ до улицы», если точка не дома. */
function addressSubtitle(hit: AddressHit, cityName: string): string {
  const note = precisionNote(hitPrecision(hit));
  return [hit.subtitle || cityName, note].filter(Boolean).join(" · ");
}
