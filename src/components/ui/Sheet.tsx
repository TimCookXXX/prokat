"use client";

// Шторка подробностей: справа на десктопе, лист снизу на телефоне, и лист
// тянется пальцем — закрывается и по расстоянию, и по рывку. Это vaul; ловля
// жеста поверх Radix Dialog была бы третьей реализацией того, что vaul делает
// из коробки, — а полоска-ручка без жеста в Modal уже была враньём интерфейса.
//
// Граница с Modal, чтобы два примитива снова не разъехались:
// - Modal — ПРЕРЫВАНИЕ: вопрос, форма, подтверждение. Центрированное окно,
//   закрыть — значит ответить или отказаться.
// - Sheet — ПОДРОБНОСТИ выбранного из списка: открыт рядом с ним, живёт в
//   адресе, «назад» его закрывает, содержимое можно листать.
// Новое окно, которое не подробности строки списка, — это Modal.
//
// Направление меряется в JS, и здесь это честно — в отличие от Modal, которому
// медиа-запрос обязателен. Тот рендерится открытым с сервера, где ширины ещё
// нет; шторка же открывается только жестом на клиенте, SSR всегда отдаёт её
// закрытой, и к моменту открытия ширина известна. Смена ширины при открытой
// шторке направление не меняет — это осознанно: перестройка dialog под руками
// хуже, чем лист, доживающий до закрытия.

import * as React from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const DESKTOP = "(min-width: 768px)"; // тот же md, что у Modal

function useIsDesktop(): boolean {
  const subscribe = React.useCallback((cb: () => void) => {
    const mq = window.matchMedia(DESKTOP);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, []);
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    // Серверное значение не влияет: закрытая шторка не рендерит контент.
    () => false,
  );
}

export function Sheet({
  open, onOpenChange, label, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Доступное имя окна — скринридер объявляет его при открытии. */
  label: string;
  children: React.ReactNode;
}) {
  const desktop = useIsDesktop();
  /* Направление фиксируется на момент открытия. Инициализация ленивая и
   * читает экран сразу: со стартовым "right" первый open на телефоне (и любой
   * deep-link из мессенджера — типично мобильный сценарий) коммитил правую
   * панель и перещёлкивал её вниз посреди входной анимации. На сервере ширины
   * нет, но там шторка и не открывается. */
  const [side, setSide] = React.useState<"right" | "bottom">(() =>
    typeof window === "undefined" || window.matchMedia(DESKTOP).matches
      ? "right"
      : "bottom");
  React.useEffect(() => {
    // desktop нарочно не в зависимостях: направление меняется только на
    // открытии, а не при каждой смене ширины под открытой шторкой.
    if (open) setSide(desktop ? "right" : "bottom");
  }, [open]);

  const right = side === "right";
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={side}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        {/* Настоящий Title, а не aria-label: Radix ищет элемент по id и
          * пишет console.error на каждое открытие, не глядя на aria-label.
          * aria-describedby гасим — описания у шторки нет, а Radix проставляет
          * ссылку всегда. */}
        <Drawer.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col border-border bg-card focus:[outline:none]",
            right
              ? "inset-y-0 right-0 w-[min(26rem,92vw)] border-l"
              : "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-lg border-t",
          )}
        >
          {/* Ручка — только у листа: она обещает жест, и здесь он есть. */}
          {!right && (
            <div className="flex-none cursor-grab py-2" aria-hidden="true">
              <div className="mx-auto h-1 w-10 rounded-pill bg-border" />
            </div>
          )}
          <Drawer.Title className="sr-only">{label}</Drawer.Title>
          <Drawer.Close
            aria-label="Закрыть"
            className="absolute right-3 top-3 z-10 rounded-sm p-1.5 text-muted-foreground transition-colors hoverable hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Drawer.Close>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/* Разделы содержимого. Шапка и подвал не прокручиваются, тело — да:
 * кнопки решения обязаны быть видны и на длинной заявке. */
export function SheetHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-none border-b border-border px-4 pb-3 pt-4 md:pt-5">
      {children}
    </div>
  );
}

export function SheetBody({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>;
}

export function SheetFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-none flex-wrap gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}
