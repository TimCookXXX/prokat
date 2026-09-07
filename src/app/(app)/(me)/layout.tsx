// Личная зона кабинета (заявки, профиль). Единая навигация: owner-табы
// показываются всем залогиненным юзерам.

import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { countNewRequests } from "@/server/owner";
import { getCabinetIdentity } from "@/server/me";
import { getUnreadCount } from "@/server/chat";
import { AccountShell } from "@/components/account/AccountShell";
import { buildAccountNav } from "@/components/account/accountNav";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

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
