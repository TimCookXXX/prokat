// Каркас кабинета. Доступен любому залогиненному юзеру; owner-табы показываются
// всегда (каждый может разместить товар). Redirect'ов здесь нет — layout
// кэшируется при client-навигации, гейты живут в страницах.

import { requireAuthState } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { countNewRequests } from "@/server/owner";
import { getCabinetIdentity } from "@/server/me";
import { getUnreadCount } from "@/server/chat";
import { AccountShell } from "@/components/account/AccountShell";
import { buildAccountNav } from "@/components/account/accountNav";

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  // unreadMessages читается и здесь тоже: без него бейдж «Сообщения» пропадал
  // во всей ветке /cabinet, включая мобильный хаб — самый видный экран кабинета.
  const [newCount, unread, identity] = await Promise.all([
    countNewRequests(session.user.id),
    getUnreadCount(session.user.id),
    getCabinetIdentity(session.user.id),
  ]);

  return (
    <AccountShell
      groups={buildAccountNav({
        newRequestsCount: newCount,
        unreadMessages: unread,
        activeListings: identity?.activeListings,
      })}
      identity={identity}
    >
      {children}
    </AccountShell>
  );
}
