import Link from "next/link";
import { content } from "@theme/content";
import { Logo } from "@/components/brand/Logo";
import { ThemeSegmented } from "@/components/providers/ThemeSegmented";
import { isP2PEnabled } from "@/lib/features";

export function Footer() {
  const columns = isP2PEnabled()
    ? [...content.footer.p2pColumns, ...content.footer.columns]
    : content.footer.columns;
  return (
    <footer className="mx-auto mt-10 w-full max-w-[1200px] px-4 pb-6">
      <div className="surface p-6 sm:p-8">
        {/* Сетка, а не space-between: колонки разной длины иначе расползаются по
         * краям. На мобайле два столбца, знак над ними во всю ширину. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[1.5fr_repeat(3,1fr)] lg:gap-x-8">
          <div className="col-span-2 flex flex-col items-start gap-3 lg:col-span-1">
            <Link href="/" className="flex items-center" aria-label={content.site.name}>
              <Logo size={22} />
            </Link>
            <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
              {content.footer.about}
            </p>
          </div>

          {columns.map((col) => (
            <nav key={col.title} className="flex flex-col gap-3">
              <span className="font-mono text-2xs uppercase tracking-mono text-muted-foreground">
                {col.title}
              </span>
              {col.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href as never}
                  className="text-sm leading-none text-foreground/80 transition-colors hover:text-accent"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>

        {/* Переключатель темы — в правом нижнем углу. Тот же, что в меню
         * пользователя; здесь он для анонима, у которого меню нет. */}
        <div className="mt-9 flex items-end justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {content.copyright} · {content.footer.disclaimer}
          </p>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {content.footer.themeLabel}
            <ThemeSegmented />
          </span>
        </div>
      </div>
    </footer>
  );
}
