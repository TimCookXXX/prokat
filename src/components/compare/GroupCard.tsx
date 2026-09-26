import Link from "next/link";
import {
  Bike, Construction, Cylinder, Disc, Drill, Droplets, Hammer, Layers, Split, Wind, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import { formatRub } from "@/lib/compare/pricing";
import { shopsLabel } from "@/lib/compare/format";
import type { NavGroup } from "@/server/compare";

// Фото товаров чужие — не копируем. Вместо фото — пиктограмма группы на
// заглушке --color-photo; новая группа без своей иконки получает гаечный ключ.
const ICONS: [RegExp, LucideIcon][] = [
  [/perforator/, Drill],
  [/otboyn/, Hammer],
  [/betonomeshalk/, Cylinder],
  [/vibroplit/, Layers],
  [/shtroborez/, Split],
  [/generator/, Zap],
  [/vyshk/, Construction],
  [/bolgark|ushm/, Disc],
  [/pylesos/, Droplets],
  [/paroochistitel/, Wind],
  [/velosiped/, Bike],
];

export function groupIcon(slug: string): LucideIcon {
  return ICONS.find(([re]) => re.test(slug))?.[1] ?? Wrench;
}

// Карточка группы (DESIGN_SYSTEM → CategoryCard): название и число прокатов
// слева, «от / 350 ₽ / в сутки» справа.
export function GroupCard({ group, href }: { group: NavGroup; href: string }) {
  const Icon = groupIcon(group.slug);
  return (
    <Link
      href={href as never}
      className="group flex flex-col overflow-hidden rounded-lg bg-card shadow-card transition-transform hover:-translate-y-0.5"
    >
      <div className="flex h-[120px] items-center justify-center bg-photo text-primary/70 md:h-[150px]">
        <Icon className="h-14 w-14 transition-transform group-hover:scale-105" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="flex items-end justify-between gap-3 px-[18px] py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base font-semibold md:text-lg">{group.name}</span>
          <span className="text-[13px] text-muted-foreground">
            {group.shops ? shopsLabel(group.shops) : "цены собираем"}
          </span>
        </div>
        {group.fromPrice && (
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-xs text-muted-foreground">от</span>
            <span className="price text-lg md:text-xl">{formatRub(group.fromPrice.rub)}</span>
            <span className="text-xs text-muted-foreground">{group.fromPrice.per === "day" ? "в сутки" : "в неделю"}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

/** Карточка популярной модели: как у группы, но с моделью и её ценой «от». */
export function ModelCard({
  title, groupSlug, shops, fromDay, href,
}: {
  title: string;
  groupSlug: string;
  shops: number;
  fromDay: number | null;
  href: string;
}) {
  const Icon = groupIcon(groupSlug);
  return (
    <Link href={href as never} className="flex items-center gap-3.5 rounded-lg bg-card p-3.5 shadow-card transition-transform hover:-translate-y-0.5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-field bg-photo text-primary/70">
        <Icon className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-muted-foreground">{shopsLabel(shops)}</span>
      </span>
      {fromDay != null && (
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-xs text-muted-foreground">от</span>
          <span className="price text-base">{formatRub(fromDay)}</span>
        </span>
      )}
    </Link>
  );
}
