"use client";

import { useState, useTransition } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revealShopPhone } from "@/server/actions/leads";
import { reachGoal } from "@/lib/analytics";
import type { TabId } from "@/lib/compare/pricing";

// «Показать телефон»: номер приходит с сервера только по клику — так обращение
// попадает и в lead_events, и в цели Метрики. После клика — номер ссылкой tel:
// и подсказка сказать, откуда узнали.
export function PhoneReveal({
  offerId,
  shopId,
  winner = false,
  tab,
  rank,
  scenario,
  className,
}: {
  offerId?: string;
  shopId?: string;
  /** Победитель вкладки — оранжевая кнопка, остальные — бренд. */
  winner?: boolean;
  tab?: TabId;
  rank?: number;
  scenario?: { days: number; needDelivery: boolean };
  className?: string;
}) {
  const [phone, setPhone] = useState<{ phone: string; display: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (phone) {
    return (
      <div className={className}>
        <a href={`tel:${phone.phone}`} className="block text-[17px] font-bold tabular-nums hover:text-accent">
          {phone.display}
        </a>
        <p className="text-xs text-muted-foreground">Скажите, что нашли на inrenta</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant={winner ? "cta" : "default"}
        className="h-11 w-full text-[15px] md:h-11"
        pending={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await revealShopPhone({ offerId, shopId, tab, rank, scenario });
            if (res.ok) {
              setPhone(res.data);
              reachGoal("show_phone", { tab, rank });
            } else {
              setError(res.error === "no_phone"
                ? "Телефона пока нет — уточняем"
                : res.error === "rate_limited"
                  ? "Слишком много запросов, попробуйте позже"
                  : "Не получилось, попробуйте ещё раз");
            }
          });
        }}
      >
        {!pending && <Phone className="mr-2 h-4 w-4" aria-hidden="true" />}
        Показать телефон
      </Button>
      {error && <p role="alert" className="mt-1 text-xs text-warn">{error}</p>}
    </div>
  );
}
