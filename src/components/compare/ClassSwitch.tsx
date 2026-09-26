import Link from "next/link";
import { cn } from "@/lib/utils";

// Классы внутри группы (SDS-plus / SDS-max): сравниваем внутри класса, между
// классами переключаемся. Показывается, только если классов больше одного.
export function ClassSwitch({
  classes,
}: {
  classes: { slug: string; name: string; hint: string | null; count: number; href: string; active: boolean }[];
}) {
  if (classes.length < 2) return null;
  return (
    <nav aria-label="Класс" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
      {classes.map((c) => (
        <Link
          key={c.slug}
          href={c.href as never}
          scroll={false}
          aria-current={c.active ? "page" : undefined}
          className={cn(
            "flex min-h-[44px] shrink-0 flex-col justify-center rounded-field border px-3.5 py-1.5 text-left transition-colors",
            c.active ? "border-primary bg-card" : "border-transparent bg-card/60 hover:bg-card",
          )}
        >
          <span className="text-sm font-semibold">{c.name}</span>
          <span className="text-xs text-muted-foreground">
            {c.hint ? `${c.hint} · ` : ""}{c.count ? `${c.count} предл.` : "пока нет цен"}
          </span>
        </Link>
      ))}
    </nav>
  );
}
