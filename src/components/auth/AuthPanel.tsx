"use client";

// Вход двумя шагами: почта с паролем на первом экране, список сервисов — на
// втором. Шаг живёт состоянием внутри карточки, а не отдельным URL: тогда один
// и тот же компонент работает и на /login, и в модалке брони, где нельзя
// уходить со страницы, чтобы не потерять выбранные даты.

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiVk } from "react-icons/si";
import { FaYandex } from "react-icons/fa6";
import { Logo } from "@/components/brand/Logo";
import { EmailAuthForm } from "@/components/auth/EmailAuthForm";
import { ProviderButtons } from "@/components/auth/ProviderButtons";
import { AutoHeight } from "@/components/ui/AutoHeight";

const ARROW = "absolute left-0 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function AuthPanel({
  nextAuthProviders,
  vkEnabled,
  canRegister,
  callbackUrl = "/",
  homeHref = null,
}: {
  nextAuthProviders: string[];
  vkEnabled: boolean;
  // Регистрация и сброс требуют письма; вход по паролю — нет.
  canRegister: boolean;
  callbackUrl?: string;
  // Куда ведёт стрелка на первом шаге. В модалке брони её нет: оттуда выходят
  // крестиком, а уход со страницы потерял бы выбранные даты.
  homeHref?: string | null;
}) {
  const [step, setStep] = useState<"email" | "providers">("email");
  const hasProviders = nextAuthProviders.length > 0 || vkEnabled;

  // Шапка карточки: знак по центру, стрелка — слева на его уровне.
  const header = (back: React.ReactNode) => (
    <div className="relative flex items-center justify-center">
      {back}
      <Logo size={22} />
    </div>
  );

  const providersStep = (
    <div className="flex flex-col gap-5">
        {header(
          <button
            type="button"
            onClick={() => setStep("email")}
            aria-label="Назад ко входу по почте"
            className={ARROW}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>,
        )}

        <h2 className="text-center font-display text-lg">Выберите сервис для входа</h2>

        <ProviderButtons
          nextAuthProviders={nextAuthProviders}
          vkEnabled={vkEnabled}
          callbackUrl={callbackUrl}
        />
    </div>
  );

  const emailStep = (
    <div className="flex flex-col gap-5">
      {header(
        homeHref ? (
          <Link href={homeHref as never} aria-label="На главную" className={ARROW}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        ) : null,
      )}

      <EmailAuthForm canRegister={canRegister} callbackUrl={callbackUrl} />

      {hasProviders && (
        <button
          type="button"
          onClick={() => setStep("providers")}
          className="flex h-12 w-full items-center justify-between rounded-pill bg-accent px-5 text-accent-foreground transition-opacity hover:opacity-90"
        >
          <span className="text-sm font-medium">Войти с помощью</span>
          <span className="flex items-center gap-2">
            <FaYandex className="h-5 w-5" aria-hidden="true" />
            <SiVk className="h-5 w-5" aria-hidden="true" />
          </span>
        </button>
      )}

      {/* Быстрый вход для разработки. NODE_ENV подставляется на сборке, поэтому
        * в проде блок вырезается из бандла целиком. Сам роут тоже отвечает 404
        * вне дева — это не единственная защита. Живёт здесь, а не на странице
        * входа: так он есть и в модалках, без прокидывания флага по дереву. */}
      {process.env.NODE_ENV !== "production" && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-center text-xs text-muted-foreground">dev only</p>
          {[
            { href: `/api/dev/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, label: "Войти как Dev User" },
            { href: `/api/dev/login?role=admin&callbackUrl=${encodeURIComponent(callbackUrl)}`, label: "Войти как Dev Admin" },
          ].map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-pill border border-border bg-muted/50 px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-muted"
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );

  // Обёртка держит высоту карточки: без неё смена шага и режима формы
  // (вход → регистрация) дёргает модалку.
  return <AutoHeight>{step === "providers" ? providersStep : emailStep}</AutoHeight>;
}
