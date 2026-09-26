import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatRub } from "@/lib/compare/pricing";
import type { TabSummary } from "@/lib/compare/view";

// Вкладки «Оптимальный · Самый дешёвый · Ближе всего» (ТЗ, п. 5.2): у города —
// две, у округа третья — «Сначала в вашем округе». В каждой — итог лучшего
// варианта и его прокат. Ссылки, а не кнопки: выбор живёт в URL.
export function ResultTabs({
  tabs,
  current,
  hrefFor,
}: {
  tabs: TabSummary[];
  current: string;
  hrefFor: Record<string, string>;
}) {
  return (
    <nav
      aria-label="Как сравнивать"
      className={cn(
        "grid gap-1 rounded-tabs bg-card p-1 max-md:gap-2 max-md:bg-transparent max-md:p-0",
        tabs.length === 3 ? "grid-cols-3" : "grid-cols-2",
      )}
    >
      {tabs.map((t) => {
        const on = t.id === current;
        return (
          <Link
            key={t.id}
            href={hrefFor[t.id] as never}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-[44px] min-w-0 flex-col gap-0.5 rounded-[11px] px-2.5 py-2.5 text-left transition-colors md:px-4 md:py-3",
              "max-md:rounded-field max-md:bg-card",
              on ? "bg-primary text-primary-foreground max-md:bg-primary" : "hover:bg-muted",
            )}
          >
            <span className={cn("truncate text-xs font-semibold md:text-[13px]", on ? "text-primary-foreground/80" : "text-muted-foreground")}>
              <span className="md:hidden">{t.shortLabel}</span>
              <span className="max-md:hidden">{t.label}</span>
            </span>
            <span className="price text-[17px] md:text-xl">{t.best ? formatRub(t.best.total) : "—"}</span>
            <span className={cn("truncate text-xs max-md:hidden", on ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {t.best?.offer.shopName ?? "нет предложений"}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
