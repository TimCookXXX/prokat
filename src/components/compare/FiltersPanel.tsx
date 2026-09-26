"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRub, type Rub } from "@/lib/compare/pricing";
import {
  activeFilterCount, compareHref, patchParams, type CompareParams, type ParamsPatch,
} from "@/lib/compare/scenario";
import type { FilterPrices } from "@/lib/compare/view";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";

interface Props {
  citySlug: string;
  groupSlug: string;
  params: CompareParams;
  prices: FilterPrices;
  guide?: { title: string; text: string } | null;
}

// Боковая панель фильтров (DESIGN_SYSTEM → FiltersSidebar): у каждого варианта —
// минимальный итог при этом фильтре. Изменение сразу уходит в URL; сервер
// пересчитывает выдачу. Состояние отмечаем локально, чтобы галочка не ждала сети.
export function FiltersPanel({ citySlug, groupSlug, params, prices, guide, className }: Props & { className?: string }) {
  const router = useRouter();
  const [local, setLocal] = useState(params);
  const [pending, start] = useTransition();
  useEffect(() => setLocal(params), [params]);

  const apply = (patch: ParamsPatch) => {
    const next = patchParams(local, patch);
    setLocal(next);
    start(() => router.replace(compareHref(citySlug, groupSlug, next) as never, { scroll: false }));
  };
  const f = local.filters;

  return (
    <div className={cn("flex flex-col gap-[22px] text-sm transition-opacity", pending && "opacity-70", className)}>
      <Group title="Залог">
        <Row id="f-nodep" label="Без денежного залога" price={prices.noMoneyDeposit} from
          checked={f.noMoneyDeposit} onChange={(v) => apply({ filters: { noMoneyDeposit: v } })} />
      </Group>

      <Group title="Получение">
        <Row id="f-delivery" type="radio" name="getting" label="Привезти" price={prices.delivery} from
          checked={!local.pickup} onChange={() => apply({ pickup: false })} />
        <Row id="f-today" label="Привезут сегодня" price={prices.sameDay} from disabled={local.pickup}
          checked={f.sameDay && !local.pickup} onChange={(v) => apply({ filters: { sameDay: v } })} />
        <Row id="f-pickup" type="radio" name="getting" label="Заберу сам" price={prices.pickup} from
          checked={local.pickup} onChange={() => apply({ pickup: true, filters: { sameDay: false } })} />
      </Group>

      <Group title="Прокат">
        <Row id="f-claimed" label="Подтвердил цены" price={prices.claimed} from
          checked={f.claimed} onChange={(v) => apply({ filters: { claimed: v } })} />
        <Row id="f-min1" label="Сдаёт от 1 суток" price={prices.oneDay} from
          checked={f.oneDay} onChange={(v) => apply({ filters: { oneDay: v } })} />
      </Group>

      {prices.areas.length > 1 && (
        <Group title="Район проката">
          {prices.areas.map((a, i) => (
            <Row key={a.name} id={`f-area-${i}`} label={a.name} price={a.min}
              checked={f.areas.includes(a.name)}
              onChange={(v) => apply({
                filters: { areas: v ? [...f.areas, a.name] : f.areas.filter((x) => x !== a.name) },
              })} />
          ))}
        </Group>
      )}

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
  id, label, price, from = false, checked, onChange, type = "checkbox", name, disabled = false,
}: {
  id: string;
  label: string;
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
      <span className="flex-1">{label}</span>
      <span className="tabular-nums text-muted-foreground">
        {empty ? "нет" : `${from ? "от " : ""}${formatRub(price)}`}
      </span>
    </label>
  );
}

/** Телефон: «Фильтры · N» открывает панель полноэкранным листом. */
export function FiltersSheet(props: Props & { summary: string }) {
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(props.params.filters) + (props.params.pickup ? 1 : 0);
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
          <FiltersPanel {...props} />
          <Button className="mt-5 w-full" onClick={() => setOpen(false)}>Показать</Button>
        </ModalContent>
      </Modal>
      <span className="truncate text-[13px] text-muted-foreground">{props.summary}</span>
    </div>
  );
}
