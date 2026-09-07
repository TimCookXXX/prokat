// Одна переписка. Права проверяет getThreadHeader: чужой и несуществующий тред
// одинаково дают 404 — по ответу нельзя узнать, что тред вообще есть.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { getMessages, getThreadHeader } from "@/server/chat";
import { canPostMessage } from "@/lib/chat/rules";
import { chatErrorText } from "@/lib/chat/errors";
import { ThreadTopBar, ThreadListingBar } from "@/components/chat/ThreadTopBar";
import { ThreadView } from "@/components/chat/ThreadView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Переписка",
  robots: { index: false },
};

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/chat");

  const { threadId } = await params;
  const header = await getThreadHeader(threadId, session.user.id);
  if (!header) notFound();

  const { messages, hasMore } = await getMessages(threadId);

  const verdict = canPostMessage(
    { id: session.user.id, bannedAt: session.user.bannedAt ?? null },
    header,
    { ownerUserId: header.ownerUserId, status: header.listingStatus },
    header.counterpartBannedAt,
  );

  return (
    // data-chat-thread — маркер для правила в globals.css: на мобиле оно прячет
    // таб-бар с подвалом и обнуляет --tabbar-h, освобождая экран под переписку.
    <section
      data-chat-thread
      aria-label="Переписка"
      className="flex min-h-0 flex-1 flex-col"
    >
      <ThreadTopBar header={header} />
      <ThreadListingBar header={header} />

      {/* key по треду обязателен: ленту и черновик компонент держит в
        * состоянии, а при переходе между переписками React переиспользовал бы
        * его на том же месте дерева — и в новой переписке показал бы сообщения
        * предыдущей. key заставляет смонтировать заново. */}
      <ThreadView
        key={threadId}
        mode={{ kind: "thread", threadId }}
        viewerId={session.user.id}
        initialMessages={messages}
        initialHasMore={hasMore}
        viewerCursor={header.viewerLastReadMessageId}
        counterpartCursor={header.counterpartLastReadMessageId}
        counterpartName={header.counterpartName}
        blockedReason={verdict.ok ? undefined : chatErrorText(verdict.reason)}
      />
    </section>
  );
}
