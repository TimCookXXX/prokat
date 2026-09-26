// Анонимный посетитель для учёта обращений (lead_events): id сессии в cookie и
// UTM-метки первого захода. Модуль без Node-зависимостей — его читает и edge-middleware.

export const SID_COOKIE = "inr_sid";
export const UTM_COOKIE = "inr_utm";
export const SID_MAX_AGE = 60 * 60 * 24 * 365;
export const UTM_MAX_AGE = 60 * 60 * 24 * 30;

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "yclid"] as const;

/** UTM-метки из query; null — меток нет. Значения обрезаются: cookie не резиновая. */
export function utmFromSearch(params: URLSearchParams): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) out[k] = v.slice(0, 100);
  }
  return Object.keys(out).length ? out : null;
}

export function parseUtmCookie(raw: string | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if ((UTM_KEYS as readonly string[]).includes(k) && typeof val === "string") out[k] = val.slice(0, 100);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function isValidSid(v: string | undefined): v is string {
  return !!v && /^[A-Za-z0-9-]{16,64}$/.test(v);
}
