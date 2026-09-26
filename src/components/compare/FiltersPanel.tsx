"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRub, type Rub } from "@/lib/compare/pricing";
import {
  activeFilterCount, patchParams, resultHref, type ParamsPatch, type ResultParams,
} from "@/lib/compare/scenario";
import type { FilterPrices } from "@/lib/compare/view";
import type { TabId } from "@/lib/compare/ranking";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";

interface Props {
  /** Путь страницы выдачи — параметры фильтров дописываются к нему. */
  path: string;
  params: ResultParams;
  prices: FilterPrices;
  /** Фильтр по модели — только при поиске по классу (на странице модели он не нужен). */
  showModels?: boolean;
  /** Вкладка выдачи — цены у фильтров считаются для неё. */
  activeTab: TabId;
  /** Префикс id: панель рисуется дважды (сбоку и в листе на телефоне) — id не должны совпадать. */
  idPrefix?: string;
  guide?: { title: string; text: string } | null;
}

// Боковая панель фильтров (ТЗ, п. 5.6): у каждого варианта — минимальный итог при
// этом фильтре; фильтры сочетаются по «И». Изменение сразу уходит в URL; сервер
// пересчитывает выдачу. Состояние отмечаем локально, чтобы галочка не ждала сети.
export function FiltersPanel({ path, params, prices, showModels = true, activeTab, idPrefix = "f", guide, className }: Props & { className?: string }) {
  const router = useRouter();
  const [local, setLocal] = useState(params);
  const [pending, start] = useTransition();
  useEffect(() => setLocal(params), [params]);

  const apply = (patch: ParamsPatch) => {
    const next = patchParams(local, patch);
    setLocal(next);
    start(() => router.replace(resultHref(path, next) as never, { scroll: false }));
  };
  const f = local.filters;
  // Цена у варианта — итог первой карточки после его применения; на «Самом дешёвом»
  // это и минимальный итог, поэтому «от».
  const fromLabel = activeTab === "cheapest";

  return (
    <div className={cn("flex flex-col gap-[22px] text-sm transition-opacity", pending && "opacity-70", className)}>
      <Group title="Залог">
        <Row id={`${idPrefix}-nodep`} label="Без денежного залога" price={prices.noMoneyDeposit} from={fromLabel}
          checked={f.noMoneyDeposit} onChange={(v) => apply({ filters: { noMoneyDeposit: v } })} />
      </Group>

      <Group title="Прокат">
        <Row id={`${idPrefix}-claimed`} label="Подтвердил цены" price={prices.claimed} from={fromLabel}
          checked={f.claimed} onChange={(v) => apply({ filters: { claimed: v } })} />
        <Row id={`${idPrefix}-min1`} label="Сдаёт от 1 суток" price={prices.oneDay} from={fromLabel}
          checked={f.oneDay} onChange={(v) => apply({ filters: { oneDay: v } })} />
        <Row id={`${idPrefix}-open`} label="Работает сегодня" price={prices.openToday} from={fromLabel}
          checked={f.openToday} onChange={(v) => apply({ filters: { openToday: v } })} />
      </Group>

      {showModels && prices.models.length > 1 && (
        <Group title="Модель">
          {prices.models.map((m, i) => (
            <Row key={m.slug} id={`${idPrefix}-model-${i}`} label={m.name} hint={`${m.count}`} price={m.min} from={fromLabel}
              checked={f.models.includes(m.slug)}
              onChange={(v) => apply({
                filters: { models: v ? [...f.models, m.slug] : f.models.filter((x) => x !== m.slug) },
              })} />
          ))}
        </Group>
      )}

      <Group title="Округ">
        {prices.okrugs.map((o, i) => (
          <Row key={o.slug} id={`${idPrefix}-okrug-${i}`} label={o.name.replace(" округ", "")} price={o.min} from={fromLabel}
            checked={f.okrugs.includes(o.slug)}
            onChange={(v) => apply({
              filters: { okrugs: v ? [...f.okrugs, o.slug] : f.okrugs.filter((x) => x !== o.slug) },
            })} />
        ))}
      </Group>

      {guide && (
        <div className="flex flex-col gap-2 rounded-tabs bg-card p-4">
          <span className="text-[15px] font-bold">{guide.title}</span>
          <p className="text-[13px] leading-normal text-muted-foreground">{guide.text}</p>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1.5 text-[15px] font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

function Row({
  id, label, hint, price, from = false, checked, onChange, type = "checkbox", name, disabled = false,
}: {
  id: string;
  label: string;
  /** Число предложений рядом с названием: «Makita HR2470 · 3». */
  hint?: string;
  price: Rub | null;
  /** «от 1 350 ₽» вместо просто суммы. */
  from?: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
  type?: "checkbox" | "radio";
  name?: string;
  disabled?: boolean;
}) {
  const empty = price === null;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-[36px] cursor-pointer items-center gap-2.5 rounded-md",
        (disabled || (empty && !checked)) && "cursor-default text-muted-foreground",
      )}
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        disabled={disabled || (empty && !checked)}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[18px] w-[18px] shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1">
        {label}
        {hint && <span className="text-muted-foreground"> · {hint}</span>}
      </span>
      <span className="tabular-nums text-muted-foreground">
        {empty ? "нет" : `${from ? "от " : ""}${formatRub(price)}`}
      </span>
    </label>
  );
}

/** Телефон: «Фильтры · N» открывает панель полноэкранным листом. */
export function FiltersSheet(props: Props & { summary: string }) {
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(props.params.filters);
  return (
    <div className="flex items-center gap-2 md:hidden">
      <Modal open={open} onOpenChange={setOpen}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-pill bg-card px-3.5 text-sm font-semibold"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Фильтры{n ? ` · ${n}` : ""}
        </button>
        <ModalContent className="md:max-w-md">
          <ModalTitle className="mb-4 font-display text-lg font-semibold">Фильтры</ModalTitle>
          <FiltersPanel {...props} idPrefix="fm" />
          <Button className="mt-5 w-full" onClick={() => setOpen(false)}>Показать</Button>
        </ModalContent>
      </Modal>
      <span className="truncate text-[13px] text-muted-foreground">{props.summary}</span>
    </div>
  );
}
