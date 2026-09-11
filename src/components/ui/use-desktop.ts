"use client";

// Ширина экрана как подписка. Порог один на все окна — md, тот же брейкпоинт,
// что в Tailwind-разметке.
//
// Мерять экран в JS законно только для того, что не рендерится открытым с
// сервера: Modal и Sheet открываются жестом на клиенте, и к моменту открытия
// ширина известна. Серверный снапшот — «мобайл»; на закрытом окне подмена
// после гидрации невидима.
//
// Гарда на matchMedia обязательна: в jsdom его нет, а Modal транзитивно
// рендерят полдюжины тестовых файлов — закрытым, но рендерят.

import * as React from "react";

const DESKTOP = "(min-width: 768px)";

export function useIsDesktop(): boolean {
  const subscribe = React.useCallback((cb: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return () => {};
    }
    const mq = window.matchMedia(DESKTOP);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, []);
  return React.useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia(DESKTOP).matches,
    () => false,
  );
}
