import { auth } from "@/lib/auth";
import { authPanelProps } from "@/lib/auth/panel-props";
import { isP2PEnabled } from "@/lib/features";
import { TabBar } from "./TabBar";

// Серверная обёртка таб-бара: та же логика гейта «Разместить», что и в Header
// (аноним → /login, авторизованный без username → /welcome).
export async function MobileNav() {
  // Все пункты таб-бара, кроме профиля, — P2P-разделы. Без контура вход и
  // профиль на телефоне живут в шапке.
  if (!isP2PEnabled()) return null;
  const session = await auth();
  const user = session?.user;
  const placeHref = !user ? "/login" : user.username ? "/cabinet/listings/new" : "/welcome";

  const authProps = authPanelProps();

  return (
    <TabBar
      placeHref={placeHref}
      authProps={authProps}
      user={
        user
          ? { name: user.name ?? null, username: user.username ?? null, image: user.image ?? null }
          : null
      }
    />
  );
}
