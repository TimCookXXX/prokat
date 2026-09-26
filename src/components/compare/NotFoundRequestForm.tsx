"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createNotFoundRequest } from "@/server/actions/leads";
import { reachGoal } from "@/lib/analytics";

const INPUT = "h-11 w-full rounded-field border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

// «Не нашли — найдём за 30 минут» (ТЗ, п. 5.9): что нужно, даты, контакт →
// заявка в regular_requests и событие request.
export function NotFoundRequestForm({ citySlug, what, period }: { citySlug: string; what: string; period: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="rounded-lg bg-card p-5 text-sm shadow-card">
        <b className="font-semibold">Спасибо!</b> Обзвоним прокаты и напишем вам в течение 30 минут в рабочее время.
      </div>
    );
  }

  return (
    <section aria-labelledby="nf-title" className="rounded-lg bg-card p-5 shadow-card">
      <h2 id="nf-title" className="text-base font-semibold">Не нашли — найдём за 30 минут</h2>
      <p className="mt-1 text-sm text-muted-foreground">Обзвоним прокаты сами и пришлём, у кого есть и почём.</p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const res = await createNotFoundRequest({
              citySlug,
              what: String(fd.get("what") ?? ""),
              period: String(fd.get("period") ?? ""),
              contact: String(fd.get("contact") ?? ""),
              website: String(fd.get("website") ?? ""),
            });
            if (res.ok) { setDone(true); reachGoal("request"); } else setError(res.error === "invalid_input" ? "Проверьте поля" : res.error);
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Что нужно
          <input name="what" defaultValue={what} required minLength={2} maxLength={300} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Когда
          <input name="period" defaultValue={period} maxLength={60} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Телефон или Telegram
          <input name="contact" required minLength={5} maxLength={120} placeholder="+7… или @username" className={INPUT} />
        </label>
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        {error && <p role="alert" className="text-sm text-warn sm:col-span-2">{error}</p>}
        <Button type="submit" variant="cta" pending={pending} className="sm:col-span-2">Найти за меня</Button>
      </form>
    </section>
  );
}
