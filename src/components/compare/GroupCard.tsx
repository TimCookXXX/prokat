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
