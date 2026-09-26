import Link from "next/link";
import { Plus } from "lucide-react";
import { content } from "@theme/content";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { authPanelProps } from "@/lib/auth/panel-props";
import { LoginTrigger } from "@/components/auth/LoginTrigger";
import { getActiveCities } from "@/server/catalog";
import { UserMenu } from "@/components/auth/UserMenu";
import { isP2PEnabled } from "@/lib/features";
import { userOwnsShop } from "@/server/shops";
import { CitySelector } from "./CitySelector";
import { HeaderSearch } from "./HeaderSearch";

// Шапка варианта Б: сплошная полоса бренд-цвета. Страница сравнения продолжает
// её своим блоком поиска (тот же bg-header), поэтому снизу у шапки нет отступа.
export async function Header() {
  const [session, cities] = await Promise.all([auth(), getActiveCities()]);
  const user = session?.user;
  // P2P-контур добавляет поиск по объявлениям и «Разместить».
  const p2p = isP2PEnabled();
  const shopOwner = user?.id ? await userOwnsShop(user.id) : false;
  // Аноним → /login; авторизованный без username → /welcome (гейт онбординга);
  // иначе прямиком в создание объявления.
  const placeHref = !user ? "/login" : user.username ? "/cabinet/listings/new" : "/welcome";

  // Флаги для модалки входа: аноним входит, не уходя со страницы.
  const authProps = authPanelProps();
  const navLink = "text-sm text-header-muted transition-colors hover:text-header-foreground";

  return (
    <header className="bg-header text-header-foreground">
      <div className="page flex h-14 items-center gap-3 md:h-16 md:gap-6">
        <Link href="/" className="flex shrink-0 items-center" aria-label={content.site.name}>
          <Logo size={20} word={content.site.name} onDark />
        </Link>
        <CitySelector cities={cities.map((c) => ({ slug: c.slug, name: c.name }))} onDark />

        {p2p && <HeaderSearch className="hidden min-w-0 max-w-md flex-1 md:flex" />}
        <div className="flex-1" />

        <nav aria-label="О сервисе" className="hidden items-center gap-6 md:flex">
          <Link href="/kak-schitaem-ceny" className={navLink}>{content.nav.howWeCount}</Link>
          <Link href="/dlya-prokatov" className={navLink}>{content.nav.forShops}</Link>
        </nav>

        {p2p && (
          <Button asChild size="sm" variant="cta" className="hidden shrink-0 md:inline-flex">
            {/* Анониму «Разместить» открывает вход модалкой и возвращает
              * на ту же страницу; остальным — обычная ссылка. */}
            {user ? (
              <Link href={placeHref as never} aria-label={content.nav.place}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {content.nav.place}
              </Link>
            ) : (
              <LoginTrigger {...authProps} aria-label={content.nav.place}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {content.nav.place}
              </LoginTrigger>
            )}
          </Button>
        )}

        {/* Профиль или вход. Тема — в меню пользователя, у анонима — в подвале. */}
        <div className="flex shrink-0 items-center">
          {user?.username ? (
            <UserMenu
              username={user.username}
              name={user.name ?? null}
              image={user.image ?? null}
              isAdmin={user.role === "admin"}
              p2p={p2p}
              shopOwner={shopOwner}
            />
          ) : user ? (
            <Link href="/welcome" className={navLink}>{content.auth.chooseUsername}</Link>
          ) : (
            <LoginTrigger {...authProps} className={navLink}>{content.nav.login}</LoginTrigger>
          )}
        </div>
      </div>
    </header>
  );
}
