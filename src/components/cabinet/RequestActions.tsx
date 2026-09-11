"use client";

// Действия по заявке — обе стороны в одном компоненте. Лента показывает роли
// вперемешку, и решать, чьи кнопки рисовать, обязан он сам: снаружи это
// решалось бы в каждом месте заново, а промах даёт арендатору «Подтвердить».
//
// Критический путь владельца «подтвердить» — один тап. Поля для причины здесь
// нет: объяснение пишется в переписке по вещи, где клиент может ответить.
// Цена этого решения названа в ADR 0017.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  cancelConfirmedByOwner, completeRequest, confirmRequest, declineRequest,
} from "@/server/actions/owner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cancelBookingRequest } from "@/server/actions/booking";
import { canTransition, type BookingStatus } from "@/lib/catalog/booking-status";
import type { RequestSide } from "@/lib/booking/request-access";

function humanError(code: string): string {
  if (code.startsWith("dates_taken:")) {
    return "Эти даты уже заняты (другая бронь или закрытие) — отклоните заявку или освободите календарь.";
  }
  if (code === "bad_status") return "Статус уже изменился — обновите страницу.";
  return "Не получилось — обновите страницу.";
}

export function RequestActions({ requestId, side, status }: {
  requestId: string;
  /** Обязателен: без стороны компонент нарисовал бы арендатору кнопки владельца. */
  side: RequestSide;
  status: BookingStatus;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(humanError(r.error ?? ""));
    });
  };

  // Арендатор решений по заявке не принимает — он может только закрыть свою.
  // Отзыв новой и отмена подтверждённой — разные события с разными словами:
  // во втором случае рушится договорённость, в первом её ещё не было. Журнал
  // и письма это уже различают — кнопка не должна их смешивать.
  if (side === "customer") {
    if (!canTransition(status, "cancelled")) return null;
    const confirmed = status === "confirmed";
    return (
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" className="text-destructive">
            {confirmed ? "Отменить бронь" : "Отозвать заявку"}
          </Button>
        }
        title={confirmed ? "Отменить бронь?" : "Отозвать заявку?"}
        description={confirmed
          ? "Бронь закроется, даты освободятся, владелец получит уведомление. "
            + "Если планы снова изменятся, придётся подать заявку заново."
          : "Заявка закроется, владелец получит уведомление. "
            + "Передумаете — просто подайте заявку ещё раз."}
        confirmLabel={confirmed ? "Отменить бронь" : "Отозвать"}
        destructive
        onConfirm={async () => {
          const r = await cancelBookingRequest(requestId);
          if (!r.ok) throw new Error(humanError(r.error ?? ""));
        }}
      />
    );
  }

  if (status === "new") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" pending={pending} onClick={() => run(() => confirmRequest(requestId))}>
            Подтвердить
          </Button>
          <Button size="sm" variant="outline" pending={pending}
            onClick={() => run(() => declineRequest(requestId))}>
            Отклонить
          </Button>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
    );
  }

  /* Подтверждённая бронь. Итог аренды здесь не отмечают: он следует из
   * календаря, и заявка закрывается сама, когда даты прошли. Осталось одно
   * действие — отмена, и она же закрывает случай «клиент не пришёл»:
   * освобождает даты, чтобы вещь можно было сдать другому. */
  if (status === "confirmed") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Вовремя завершённую бронь отмечать не нужно — она закроется сама,
            * когда даты пройдут. Эта кнопка про то, чего календарь знать не
            * может: вещь вернули раньше срока. */}
          <ConfirmDialog
            trigger={<Button size="sm">Вернули раньше</Button>}
            title="Закрыть бронь досрочно?"
            description={
              "Аренда засчитается состоявшейся, а оставшиеся дни вернутся "
              + "в продажу — вещь снова можно будет забронировать. "
              + "Прожитые дни останутся занятыми."
            }
            confirmLabel="Закрыть"
            onConfirm={async () => {
              const r = await completeRequest(requestId);
              if (!r.ok) throw new Error(humanError(r.error ?? ""));
            }}
          />
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="outline" className="text-destructive">
              Отменить бронь
            </Button>
          }
          title="Отменить бронь?"
          description={
            "Бронь закроется, даты освободятся, клиент получит уведомление. "
            + "Вернуть отменённую бронь нельзя — если планы снова изменятся, "
            + "человеку придётся подать заявку заново."
          }
          confirmLabel="Отменить бронь"
          destructive
          onConfirm={async () => {
            const r = await cancelConfirmedByOwner(requestId);
            if (!r.ok) throw new Error(humanError(r.error ?? ""));
          }}
        />
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
    );
  }

  return null;
}
