"use client";

// Соединение с процессом доставки и единственное место, где живёт правило
// обновления серверных частей страницы.
//
// Провайдер стоит в корневом layout — счётчик должен оживать где угодно, а не
// только в кабинете. Соединение при этом открывается только залогиненным: флаг
// приезжает заголовком из middleware, поэтому третьего auth() на каждой
// публичной странице не нужно.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CLOSE, isTerminalClose, type ClientFrame,
} from "@/lib/realtime/events";
import type { RequestNotificationKind } from "@/lib/notifications/kinds";
import { content } from "@theme/content";
import { toast } from "sonner";
import { fetchRealtimeUpdate } from "@/server/actions/realtime";
import { createRealtimeStore } from "@/components/realtime/store";
import { RealtimeContext } from "@/components/realtime/context";


// Адрес строится из location, а не из переменной окружения. NEXT_PUBLIC_* она
// была бы обязана быть, а такая переменная запекается на next build — то есть
// вернулась бы цепочка build arg'ов через четыре файла и целый класс отказов
// «прод-бандл уехал с пустым адресом, вскрылось только в браузере».
// В деве Caddy нет: Next на :3000, сокет на :3100. Именно location.hostname, а
// не localhost, — с телефона страницу открывают по 192.168.x.x.
const DEV_REALTIME_PORT = 3100;

type RealtimeEvent =
  | { type: "message"; threadId: string; messageId: string }
  | { type: "request"; requestId: string; kind: RequestNotificationKind };

function socketUrl(): string {
  if (process.env.NODE_ENV === "development") {
    return `ws://${window.location.hostname}:${DEV_REALTIME_PORT}/ws`;
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws`;
}

// Дебаунс общий для событий и отметок прочтения: на серверную часть страницы
// они действуют одинаково, а раздельные таймеры дали бы два рендера подряд.
const REFRESH_DEBOUNCE_MS = 400;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
// Один отказ — обычный сетевой сбой, три подряд — что-то, что само не
// пройдёт: чаще всего вкладка от прошлой сборки.
const MAX_PULL_FAILURES = 3;

// Refresh нужен только там, где есть что чинить: список переписок, галочки,
// серверные бейджи. На каталоге его нет вовсе, а страницы там force-dynamic —
// вызывать его значило бы гонять полный SSR выдачи на каждое чужое сообщение.
/* Показана ли сейчас та сторона, которой касается событие. Без стороны (чат)
 * и без фильтра в адресе — показана всегда. */
function sideIsOnScreen(side: "owner" | "customer" | undefined): boolean {
  if (!side) return true;
  const role = new URLSearchParams(window.location.search).get("role");
  return role !== "owner" && role !== "customer" ? true : role === side;
}

function refreshableRoute(pathname: string): boolean {
  return pathname.startsWith("/chat")
    || pathname.startsWith("/cabinet")
    || pathname.startsWith("/profile");
}

export function RealtimeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [store] = useState(createRealtimeStore);
  const router = useRouter();
  const pathname = usePathname() ?? "";

  const socketRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const failuresRef = useRef(0);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // Отложенный refresh отменяется при уходе со страницы. Без этого он
  // срабатывал уже во время навигации и просил перерисовать маршрут, который
  // в этот момент заменяется, — сервер начинал стримить ответ в соединение,
  // которое клиент тут же бросал. В логах это «The destination stream closed
  // early»: не поломка, но шум, который мы сами и создавали.
  useEffect(() => {
    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [pathname]);

  const scheduleRefresh = useCallback(() => {
    // Фоновая вкладка не перерисовывается: иначе каждое событие стоило бы
    // десятка запросов к базе на вкладку, а ядро на сервере одно.
    if (document.visibilityState !== "visible") return;
    if (!refreshableRoute(pathRef.current)) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
  }, [router]);

  // Один вызов на событие: он же приносит счётчики, он же — текст всплывашки.
  // Событие несёт только идентификаторы, тела сообщения в нём нет.
  const pull = useCallback(async (event?: RealtimeEvent) => {
    let res;
    try {
      res = await fetchRealtimeUpdate(event);
    } catch {
      // Сюда попадает и обрыв сети, и «Failed to find Server Action» —
      // вкладка от прошлой сборки, где id действий уже другие. Различить их
      // по тексту нельзя, но лечение общее: несколько отказов подряд означают,
      // что само не наладится, и человеку надо сказать про перезагрузку.
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_PULL_FAILURES) {
        store.getState().setStatus("stale");
      }
      return;
    }
    failuresRef.current = 0;
    if (!res.ok) return;
    store.getState().setCounters(res.data.counters);
    const t = res.data.toast;
    if (!t) return;
    // Всплывашка не нужна там, где человек и так смотрит: своя же переписка
    // открыта — сообщение приедет прямо в ленту.
    //
    // У заявок этого мало: лента показывает обе роли и умеет фильтроваться по
    // одной. Событие чужой стороны при активном фильтре на экран не попадёт, и
    // погасив всплывашку по одному лишь адресу, мы бы его потеряли совсем.
    // Роль читаем в момент события, а не хуком: usePathname query не отдаёт, а
    // useSearchParams в корневом провайдере тянет за собой Suspense.
    if (pathRef.current === t.href && sideIsOnScreen(t.side)) return;
    toast(t.title, {
      description: t.text,
      action: { label: content.notifications.open, onClick: () => router.push(t.href as never) },
    });
  }, [store, router]);

  useEffect(() => {
    if (!enabled) {
      // Именно idle, а не offline: аноним сокета не открывает, и жаловаться
      // ему не на что.
      store.getState().setStatus("idle");
      return;
    }
    stoppedRef.current = false;

    const connect = () => {
      if (stoppedRef.current) return;
      // Второй сокет поверх живого копил бы фантомов до потолка на пользователя,
      // после чего сервер начал бы отвечать «слишком много» на всё подряд.
      if (socketRef.current) return;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;
      store.getState().setStatus("connecting");

      // Каждый обработчик сначала убеждается, что он всё ещё «действующий»
      // сокет. В деве React монтирует эффект дважды: уборка первого прогона
      // закрывает сокет, но его onclose приходит ПОЗЖЕ — и без этой проверки он
      // обнулял бы ссылку уже на новый сокет и планировал переподключение.
      // Итог — два живых соединения на вкладку и по две всплывашки на сообщение.
      const isCurrent = () => socketRef.current === socket;

      socket.onopen = () => {
        if (!isCurrent()) return;
        attemptsRef.current = 0;
        store.getState().setStatus("online");
        void pull();
      };

      socket.onmessage = (event) => {
        if (!isCurrent()) return;
        let frame: ClientFrame;
        try {
          frame = JSON.parse(String(event.data)) as ClientFrame;
        } catch {
          return;
        }
        const state = store.getState();
        if (frame.type === "resync") {
          state.markResync();
          void pull();
        } else if (frame.type === "message") {
          state.pushMessage(frame.threadId, frame.messageId);
          // Всегда, а не по frame.counters: второе сообщение треда схлопывает
          // уведомление, флаг приходит false — а непрочитанных сообщений при
          // этом стало больше, и бейдж замер бы на прежнем числе. Числа
          // абсолютные, лишний вызов безвреден.
          void pull({ type: "message", threadId: frame.threadId, messageId: frame.messageId });
        } else if (frame.type === "request") {
          void pull({ type: "request", requestId: frame.requestId, kind: frame.kind });
        } else if (frame.type === "read") {
          // Ни счётчиков, ни серверной перерисовки: галочки живут в состоянии
          // ленты, и полный SSR ради двух пикселей был бы дорогой платой.
          state.pushRead(frame.threadId, frame.upToId);
          return;
        }
        scheduleRefresh();
      };

      socket.onclose = (event) => {
        if (!isCurrent()) return;
        socketRef.current = null;
        const state = store.getState();
        // Счётчики перестают быть достоверными: без этого умерший realtime
        // заморозил бы бейдж на последнем известном числе навсегда.
        state.forgetCounters();

        if (isTerminalClose(event.code)) {
          // Сессии нет, бан или чужой Origin. Переподключение здесь дало бы
          // вечный цикл у вкладки с мёртвой cookie и выело бы лимитер.
          // Бан отделяется статусом — почему, см. ConnectionStatus.
          state.setStatus(event.code === CLOSE.banned ? "banned" : "unauthorized");
          stoppedRef.current = true;
          return;
        }
        state.setStatus("offline");
        // Джиттер обязателен: рестарт realtime иначе соберёт все вкладки в один
        // залп, а ядро одно.
        const wait = event.code === CLOSE.ttl
          ? BACKOFF_BASE_MS * Math.random()
          : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attemptsRef.current)
            * (0.5 + Math.random());
        attemptsRef.current += 1;
        reconnectTimer.current = setTimeout(connect, wait);
      };

      socket.onerror = () => { if (isCurrent()) socket.close(); };
    };

    connect();

    // iOS Safari замораживает вкладку: close приходит с задержкой или не
    // приходит вовсе. Возврат видимости — самостоятельный повод убедиться, что
    // канал жив, и дочитать пропущенное.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!socketRef.current && !stoppedRef.current) {
        attemptsRef.current = 0;
        connect();
      } else if (socketRef.current?.readyState === WebSocket.OPEN) {
        store.getState().markResync();
        void pull();
      }
      // События, пришедшие в скрытую вкладку, refresh не планировали — иначе
      // фоновая вкладка гоняла бы полный SSR. Значит список переписок, галочки
      // и превью протухли, и обновить их надо здесь.
      scheduleRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stoppedRef.current = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        // Ссылка обнулена ДО close(), поэтому isCurrent() в его обработчиках
        // уже вернёт false и переподключения они не запланируют.
        socket.close();
      }
    };
  }, [enabled, store, pull, scheduleRefresh]);

  return (
    <RealtimeContext.Provider value={store}>{children}</RealtimeContext.Provider>
  );
}

