import Link from "next/link";
import { Plus } from "lucide-react";
import { content } from "@theme/content";
import type { AuthPanelProps } from "@/lib/auth/panel-props";
import { Button } from "@/components/ui/button";
import { LoginTrigger } from "@/components/auth/LoginTrigger";

/* Полоса для владельцев. Единственный охряной экран проекта: охра — предмет,
 * а здесь весь разговор про вещь, которая лежит без дела.
 *
 * Полоса залита цветом и в светлой, и в тёмной теме, поэтому текст на ней
 * берётся из пары --color-accent / --color-accent-fg, а не из токенов
 * интерфейса: она о теме не знает. */
export function ListYourItemBand({
  href,
  authProps,
}: {
  href: string;
  // Задан — значит перед нами аноним: кнопка открывает вход модалкой вместо
  // ухода на /login.
  authProps?: AuthPanelProps;
}) {
  // Кнопка тёмная на охре, поэтому текст и ховер на ней светлые в обеих темах —
  // это .on-dark. Кольцо фокуса и его отбивка перекрашены отдельно: иначе они
  // считались бы по холсту страницы, а кнопка стоит на залитой полосе.
  //
  // Вариант ghost, а не default: у сплошной кнопки наведение темнит собственный
  // цвет через hover:bg-primary/90, и перебить его пришлось бы вторым hover:bg-*
  // — заливкой вместо накладки, мимо языка состояний. У ghost заливки своей нет,
  // её даёт bg-accent-foreground, а наведение остаётся накладкой .hoverable.
  const cta =
    "on-dark mt-[30px] h-[54px] gap-2 bg-accent-foreground px-7 text-base font-bold text-foreground focus-visible:ring-accent-foreground focus-visible:ring-offset-accent";

  return (
    <section className="relative overflow-hidden rounded-lg bg-accent text-accent-foreground">
      {/* Фактура домов приглушена и переведена в яркость: она должна читаться
        * тиснением по охре, а не второй картинкой поверх неё. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center opacity-[0.16] mix-blend-luminosity"
        style={{ backgroundImage: "url(/covers/houses.svg)" }}
      />

      <div className="relative grid items-center gap-8 p-4 sm:p-6 wide:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] wide:gap-12 wide:p-11">
        <div>
          {/* 52 пункта — плакатный кегль макета. На телефоне он ломается на
            * несколько строк и кричит громче героя, поэтому там ступень
            * заголовка раздела, как у остальных секций. */}
          <h2 className="max-w-[22ch] font-display text-2xl font-extrabold leading-none tracking-mark sm:text-3xl md:text-band">
            {content.home.bandTitle}
          </h2>
          <Button asChild variant="ghost" className={cta}>
            {authProps ? (
              <LoginTrigger {...authProps} redirectTo="/cabinet/listings/new">
                <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
                {content.home.bandCta}
              </LoginTrigger>
            ) : (
              <Link href={href as never}>
                <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
                {content.home.bandCta}
              </Link>
            )}
          </Button>
        </div>

        {/* Ответы на четыре вопроса, которые задают первыми. Светлая подложка
          * поверх охры, а не карточка по токенам: она лежит внутри залитого
          * блока и подчиняется его цвету. */}
        <dl className="overflow-hidden rounded-lg border border-accent-foreground/15 bg-[rgba(255,253,249,0.5)] shadow-[0_18px_40px_-24px_rgba(22,21,15,0.45)]">
          {content.home.bandFacts.map((fact, i) => (
            <div
              key={fact.q}
              className={`flex items-baseline justify-between gap-5 px-5 py-4 ${
                i > 0 ? "border-t border-accent-foreground/15" : ""
              }`}
            >
              <dt className="text-base font-semibold">{fact.q}</dt>
              <dd className="shrink-0 text-base font-bold">{fact.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
