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
import { todayStr } from "@/lib/catalog/dates";
import type { RequestSide } from "@/lib/booking/request-access";

function humanError(code: string): string {
  if (code.startsWith("dates_taken:")) {
    return "Эти даты уже заняты (другая бронь или закрытие) — отклоните заявку или освободите календарь.";
  }
  if (code === "bad_status") return "Статус уже изменился — обновите страницу.";
  // Кнопки в этом случае нет, но экшен доступен по сети мимо интерфейса.
  if (code === "not_started") {
    return "Аренда ещё не началась — возвращать нечего. Если она сорвалась, отмените бронь.";
  }
  return "Не получилось — обновите страницу.";
}

export function RequestActions({ requestId, side, status, dateFrom }: {
  requestId: string;
  /** Обязателен: без стороны компонент нарисовал бы арендатору кнопки владельца. */
  side: RequestSide;
  status: BookingStatus;
  /** Первый день брони — по нему видно, началась ли аренда. */
  dateFrom: string;
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

  /* Подтверждённая бронь. Состоявшуюся вовремя аренду здесь не отмечают: она
   * закрывается сама, когда даты прошли. Руками закрывают два случая, которых
   * календарь знать не может, — и это ровно две кнопки ниже. */
  if (status === "confirmed") {
    // Пока аренда не началась, «вернули раньше» бессмысленно: возвращать
    // нечего. Мутация это же и не пропустит (not_started) — здесь мы просто не
    // предлагаем действие, которое обязано отказать. Сегодняшний день сходится
    // с серверным: шторка монтируется только после клика, SSR её не рисует.
    const started = dateFrom <= todayStr();
    return (
      <div className="flex flex-wrap items-center gap-2">
        {started && (
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
        )}
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
    );
  }

  return null;
}
