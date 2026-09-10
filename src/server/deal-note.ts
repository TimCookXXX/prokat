// Запись о сделке в переписку по вещи. Один путь для всех, кто её пишет:
// создание заявки, решения владельца, отмена арендатором, закрытие заявок
// баном. Разъехаться этим веткам нельзя — тред служит журналом, и пропуск
// одной записи оставляет в нём дыру, которую ничем потом не восполнить.
//
// Живёт не в actions/chat.ts, потому что тот файл под "use server": оттуда
// экспортируются только server actions, а это внутренняя функция.
//
// Тред заводится здесь же, если его ещё нет. Так и должно быть: владелец
// собственный тред начать не может (canStartThread отвечает own_listing), а у
// заявок, созданных до появления журнала, треда нет вовсе — без find-or-create
// первое же решение по такой заявке писать было бы некуда.
//
// Правила переписки эта запись обходит намеренно. canPostMessage требует
// живого объявления и незабаненного собеседника, а журнал обязан дописываться
// именно в тот момент, когда всё разваливается: вещь сняли, человека забанили.
// Это не реплика, которую кто-то отправил, — это факт, который случился.

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { chatMessages, chatThreads } from "@db/schema";
import { newId, newSortableId } from "@/lib/id";
import { publish } from "@/server/realtime";
import { chatMessageNotify } from "@/lib/realtime/events";
import type { ChatSystemKind, ChatSystemMeta } from "@/lib/chat/system-message";

export type DealNote = {
  listingId: string;
  ownerUserId: string;
  customerUserId: string;
  kind: ChatSystemKind;
  meta: ChatSystemMeta;
};

/* Тред пары (объявление, арендатор). Гонка двух вкладок закрыта уникальным
 * индексом: вставка ничего не делает, повторный SELECT достаёт победителя —
 * тот же приём, что в startThread. */
async function findOrCreateThread(
  tx: Tx,
  { listingId, ownerUserId, customerUserId }: DealNote,
): Promise<string> {
  await tx.insert(chatThreads)
    .values({ id: newId(), listingId, customerUserId, ownerUserId })
    .onConflictDoNothing();
  const rows = await tx.select({ id: chatThreads.id })
    .from(chatThreads)
    .where(and(
      eq(chatThreads.listingId, listingId),
      eq(chatThreads.customerUserId, customerUserId),
    ))
    .limit(1);
  return rows[0].id;
}

export async function writeDealNote(tx: Tx, note: DealNote): Promise<void> {
  const threadId = await findOrCreateThread(tx, note);
  // Монотонный id: он же курсор пагинации и ключ сортировки ленты.
  const messageId = newSortableId();

  await tx.insert(chatMessages).values({
    id: messageId,
    threadId,
    // Ни отправителя, ни текста: запись пишет сделка, а текст собирается из
    // вида и meta при выводе. Форму держит констрейнт chat_messages_kind_shape.
    senderUserId: null,
    kind: note.kind,
    body: null,
    metaJson: note.meta,
  });

  // Свежесть треда двигаем, курсоры прочтения — нет: запись непрочитанной не
  // бывает ни у кого, и сдвигать их нечем.
  await tx.update(chatThreads)
    .set({ lastMessageAt: sql`now()` })
    .where(eq(chatThreads.id, threadId));

  /* Уведомления запись не порождает: о случившемся уже сказало событие по
   * заявке, и второй счётчик на то же самое зажигаться не должен.
   *
   * В сокет уходит существующей формой payload — той же, что у реплики.
   * Новый вид события молча терялся бы у процесса realtime, пока его контейнер
   * не пересобран: миграции гоняет только app, зависимости между процессами в
   * compose нет, и окно рассинхрона при выкладке неизбежно.
   *
   * countFor: null — счётчик не трогаем. Получатели оба: у каждого может быть
   * открыт этот тред, и запись обязана появиться там без перезагрузки. */
  await publish(tx, chatMessageNotify({
    threadId,
    messageId,
    senderId: note.ownerUserId,
    recipientId: note.customerUserId,
    inserted: false,
  }));
}
