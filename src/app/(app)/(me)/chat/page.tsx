// /chat — на десктопе заглушка правой колонки, на мобиле не видна вовсе
// (там показан список). С ?listing=<id> служит входом со страницы объявления:
// существующую переписку открывает, для новой даёт композер.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireAuthState } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { listings, users } from "@db/schema";
import { countThreads, findThreadByListing } from "@/server/chat";
import { canStartThread } from "@/lib/chat/rules";
import { chatErrorText } from "@/lib/chat/errors";
import { content } from "@theme/content";
import { ThreadView } from "@/components/chat/ThreadView";
import { ChatPersonLink } from "@/components/chat/ChatPersonLink";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Сообщения",
  robots: { index: false },
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string }>;
}) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/chat");

  const { listing: listingId } = await searchParams;
  if (!listingId) {
    // Без переписок вовсе заглушка занимает всю ширину (список слева не
    // рисуется). С переписками она нужна только на десктопе: на мобиле в этом
    // месте показан список.
    const total = await countThreads(session.user.id);
    // Карточку рисует ChatPanes — вторая .surface дала бы двойной кант внутри
    // одной панели. h-full min-h-0 нужен из-за min-h-[45svh] у EmptyState:
    // это процент от вьюпорта, а не от колонки.
    return (
      <div className={`h-full min-h-0 ${total === 0 ? "" : "hidden md:block"}`}>
        <EmptyState className="h-full">
          {total === 0 ? content.chat.emptyThreads : content.chat.emptyPick}
        </EmptyState>
      </div>
    );
  }

  // Переписка по этому объявлению уже есть — открываем её, а не заводим вторую.
  const existing = await findThreadByListing(listingId, session.user.id);
  if (existing) redirect(`/chat/${existing}`);

  const rows = await getDb().select({
    title: listings.title,
    ownerUserId: listings.ownerUserId,
    status: listings.status,
    ownerName: users.name,
    ownerImage: users.image,
    ownerBannedAt: users.bannedAt,
  })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.ownerUserId))
    .where(and(eq(listings.id, listingId)))
    .limit(1);
  const listing = rows[0];
  if (!listing) redirect("/chat");

  const verdict = canStartThread(
    { id: session.user.id, bannedAt: session.user.bannedAt ?? null },
    listing,
    listing.ownerBannedAt,
  );

  // Снятое с публикации объявление на витрине отдаёт 404 — значит и здесь его
  // название с именем владельца показывать нельзя, иначе по id из старой ссылки
  // читается скрытая карточка. Ответ совпадает с несуществующим id: по нему
  // нельзя узнать, что объявление вообще есть.
  //
  // counterpart_banned в этом списке обязателен. canStartThread проверяет бан
  // раньше статуса, поэтому у забаненного владельца до listing_not_active дело
  // не доходит — а его объявление как раз скрыто и на витрине отдаёт 404.
  if (!verdict.ok && (verdict.reason === "listing_not_active" || verdict.reason === "counterpart_banned")) {
    redirect("/chat");
  }

  return (
    <section
      aria-label="Новая переписка"
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Шапка та же, что у открытой переписки, тем же компонентом. Забаненный
        * владелец сюда не доходит — его отсекает redirect выше. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5 md:px-4">
        <ChatPersonLink
          userId={listing.ownerUserId}
          name={listing.ownerName ?? "Владелец"}
          image={listing.ownerImage}
          subtitle={listing.title}
        />
      </header>
      <ThreadView
        mode={{ kind: "new", listingId }}
        viewerId={session.user.id}
        initialMessages={[]}
        initialHasMore={false}
        blockedReason={verdict.ok ? undefined : chatErrorText(verdict.reason)}
      />
    </section>
  );
}
