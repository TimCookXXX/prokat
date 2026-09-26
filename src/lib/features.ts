import { notFound } from "next/navigation";
import { getEnv } from "@/lib/env";

// P2P-контур (объявления юзеров, календарь, заявки на бронь) живёт за флагом
// FEATURE_P2P. Выключенный контур не показывает входов в UI, его страницы
// отвечают 404, а мутации — ошибкой p2p_disabled.
export function isP2PEnabled(): boolean {
  return getEnv().FEATURE_P2P;
}

/** Гард страниц и layout'ов P2P-контура. */
export function requireP2P(): void {
  if (!isP2PEnabled()) notFound();
}

export const P2P_DISABLED = "p2p_disabled";
