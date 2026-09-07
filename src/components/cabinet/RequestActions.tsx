"use client";

// Действия по заявке — обе стороны в одном компоненте. Лента показывает роли
// вперемешку, и решать, чьи кнопки рисовать, обязан он сам: снаружи это
// решалось бы в каждом месте заново, а промах даёт арендатору «Подтвердить».
//
// Критический путь владельца «подтвердить» — один тап; комментарий (например,
// предложить другие даты) — опционально, раскрывается.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  completeRequest, confirmRequest, declineRequest, noShowRequest,
} from "@/server/actions/owner";
import { CancelRequestButton } from "@/components/booking/CancelRequestButton";
import { field } from "@/components/ui/field";
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
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(humanError(r.error ?? ""));
    });
  };

  // Арендатор решений по заявке не принимает — он может только отозвать свою.
  if (side === "customer") {
    if (!canTransition(status, "cancelled")) return null;
    return (
      <div className="flex justify-end">
        <CancelRequestButton requestId={requestId} />
      </div>
    );
  }

  if (status === "new") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" pending={pending} onClick={() => run(() => confirmRequest(requestId, comment))}>
            Подтвердить
          </Button>
          <Button size="sm" variant="outline" pending={pending}
            onClick={() => run(() => declineRequest(requestId, comment))}>
            Отклонить
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowComment((s) => !s)}>
            {showComment ? "Скрыть комментарий" : "+ Комментарий"}
          </Button>
        </div>
        {showComment && (
          <textarea
            value={comment} maxLength={500} rows={2}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Клиент увидит этот комментарий — например, предложите другие даты"
            className={`${field} px-3 py-2 text-sm`}
          />
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
    );
  }

  if (status === "confirmed") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" pending={pending} onClick={() => run(() => completeRequest(requestId))}>
            Завершена
          </Button>
          <Button size="sm" variant="ghost" pending={pending} onClick={() => run(() => noShowRequest(requestId))}>
            Неявка
          </Button>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
    );
  }

  return null;
}
