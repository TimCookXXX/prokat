"use client";

import { useState, useTransition } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createRegularRequest } from "@/server/actions/leads";
import { reachGoal } from "@/lib/analytics";

const INPUT = "h-11 w-full rounded-field border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

// «Берёте регулярно?» — проверка гипотезы о постоянных арендаторах: бригады и
// курьеры берут повторно, и прокатам такие клиенты ценнее разового чека.
export function RegularRequestForm({ citySlug, what, itemClassId }: { citySlug: string; what: string; itemClassId?: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="rounded-lg bg-card p-5 text-sm shadow-card">
        <b className="font-semibold">Спасибо!</b> Соберём условия прокатов для постоянных клиентов и напишем вам.
      </div>
    );
  }

  return (
    <section aria-label="Нужен регулярно" className="rounded-lg bg-card p-5 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Repeat className="hidden h-6 w-6 shrink-0 text-accent sm:block" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Берёте регулярно?</h2>
          <p className="text-sm text-muted-foreground">Оставьте контакт — соберём условия прокатов для постоянных клиентов.</p>
        </div>
        {!open && <Button variant="outline" onClick={() => setOpen(true)}>Оставить контакт</Button>}
      </div>

      {open && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setError(null);
            start(async () => {
              const res = await createRegularRequest({
                citySlug,
                itemClassId,
                what: String(fd.get("what") ?? ""),
                frequency: String(fd.get("frequency") ?? ""),
                contact: String(fd.get("contact") ?? ""),
                website: String(fd.get("website") ?? ""),
              });
              if (res.ok) {
                setDone(true);
                reachGoal("regular_request");
              } else {
                setError(res.error === "invalid_input" ? "Проверьте поля" : res.error);
              }
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Что нужно
            <input name="what" defaultValue={what} required maxLength={300} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Как часто
            <select name="frequency" defaultValue="Раз в месяц" className={INPUT}>
              <option>Каждую неделю</option>
              <option>Раз в месяц</option>
              <option>Несколько раз в год</option>
              <option>Постоянно, на месяцы</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Телефон или Telegram
            <input name="contact" required minLength={5} maxLength={120} autoComplete="tel" className={INPUT} />
          </label>
          {/* Ловушка для ботов: людям не видна. */}
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" pending={pending}>Отправить</Button>
          </div>
        </form>
      )}
    </section>
  );
}
