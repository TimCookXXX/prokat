"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { LoginTrigger } from "@/components/auth/LoginTrigger";
import { submitShopClaim } from "@/server/actions/shops";
import type { AuthPanelProps } from "@/lib/auth/panel-props";

const INPUT = "h-11 w-full rounded-field border border-border bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
const NEW = "__new";

// Заявка «Это мой прокат». Нужен вход: карточку потом ведёт этот аккаунт.
// Подтверждение — звонком на номер проката, поэтому просим телефон для связи.
export function ShopClaimForm({
  citySlug, shops, shopId, authProps, isAuthed, returnTo,
}: {
  citySlug: string;
  shops: { id: string; name: string; district: string | null }[];
  shopId?: string;
  authProps: AuthPanelProps;
  isAuthed: boolean;
  returnTo: string;
}) {
  const [choice, setChoice] = useState(shopId && shops.some((s) => s.id === shopId) ? shopId : shops[0]?.id ?? NEW);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!isAuthed) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">Войдите — карточку потом будет вести этот аккаунт.</p>
        <Button asChild variant="cta">
          <LoginTrigger {...authProps} redirectTo={returnTo}>Войти и подтвердить</LoginTrigger>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <p className="rounded-field bg-ok-soft p-4 text-sm text-ok">
        Заявка отправлена. Позвоним на номер проката, сверим — и откроем кабинет.
      </p>
    );
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await submitShopClaim({
            citySlug,
            shopId: choice === NEW ? "" : choice,
            shopName: String(fd.get("shopName") ?? ""),
            contactName: String(fd.get("contactName") ?? ""),
            phone: String(fd.get("phone") ?? ""),
            comment: String(fd.get("comment") ?? ""),
          });
          if (res.ok) setDone(true);
          else setError(res.error === "invalid_input" ? "Проверьте поля" : res.error);
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Ваш прокат
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className={INPUT}>
          {shops.map((s) => <option key={s.id} value={s.id}>{s.name}{s.district ? ` · ${s.district}` : ""}</option>)}
          <option value={NEW}>Моего проката нет в списке</option>
        </select>
      </label>
      {choice === NEW && (
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Название проката
          <input name="shopName" required minLength={2} maxLength={200} className={INPUT} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Как к вам обращаться
        <input name="contactName" required minLength={2} maxLength={100} autoComplete="name" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Телефон для связи
        <input name="phone" required type="tel" autoComplete="tel" placeholder="+7 900 000-00-00" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Комментарий <span className="text-muted-foreground">(необязательно)</span>
        <textarea name="comment" maxLength={1000} rows={3} className={`${INPUT} h-auto py-2`} />
      </label>
      {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" variant="cta" pending={pending}>Отправить заявку</Button>
      </div>
    </form>
  );
}
