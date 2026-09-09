// Композер новой переписки по объявлению. Сюда ведёт «Написать» со страницы
// объявления, когда переписки ещё нет; существующую открывает redirect ниже —
// он же закрывает гонку, когда тред завели в другой вкладке после загрузки
// страницы объявления.
//
// Дочерний сегмент layout'а чата, а не query-параметр списка: ChatPanes узнаёт
// открытую переписку по сегменту, и композер ведёт себя как страница треда —
// без особых веток в раскладке.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireAuthState } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { listings, users } from "@db/schema";
import { findThreadByListing } from "@/server/chat";
import { canStartThread } from "@/lib/chat/rules";
import { chatErrorText } from "@/lib/chat/errors";
import { ThreadView } from "@/components/chat/ThreadView";
import { ChatPersonLink } from "@/components/chat/ChatPersonLink";
import { ThreadBackButton } from "@/components/chat/ThreadBackButton";

export const dynamic = "force-dynamic";

// Метаданные статические намеренно: название объявления в title читалось бы
// по id даже у снятой карточки — metadata рендерится независимо от redirect'а
// в теле страницы.
export const metadata: Metadata = {
  title: "Переписка",
  robots: { index: false },
};

export default async function NewThreadPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/chat");

  const { listingId } = await params;

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
    .where(eq(listings.id, listingId))
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
    // data-chat-thread — как на /chat/[threadId]: композер занимает мобильный
    // экран целиком, и правило в globals.css прячет под ним таб-бар с подвалом.
    <section
      data-chat-thread
      aria-label="Новая переписка"
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Шапка та же, что у открытой переписки, тем же компонентом. Забаненный
        * владелец сюда не доходит — его отсекает redirect выше. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5 md:px-4">
        {/* Таб-бар на этом экране скрыт, и без кнопки назад с мобильного
          * композера не выйти. «Назад» по истории вернёт на объявление,
          * с которого пришли. */}
        <ThreadBackButton />
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
