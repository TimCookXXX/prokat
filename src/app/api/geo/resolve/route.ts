// Переходный маршрут для вкладок, открытых до перехода на свой геокодер: их WhereField ещё
// просит координаты выбранной подсказки отдельным запросом (uri, title, subtitle). Новый
// клиент сюда не ходит — координаты приходят в самой подсказке (/api/geo/suggest).
// uri Яндекса не используется: ищем текст подсказки своим геокодером. Удалить через релиз.
import { NextResponse, type NextRequest } from "next/server";
import { suggestAddresses } from "@/server/geocoder";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { parseCity } from "@/lib/http/geo-params";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const title = (sp.get("title") ?? "").trim().slice(0, 200);
  // Подпись старых подсказок: «посёлок городского типа Яблоновский, Тахтамукайский район, …» — берём пункт.
  const place = (sp.get("subtitle") ?? "").split(",")[0].trim().slice(0, 120);
  const city = parseCity(sp.get("city"));
  if (!title || !city) return NextResponse.json({ point: null, status: "error" }, { status: 400 });
  if (!checkLimit(clientIp(req.headers), "geo").ok) return NextResponse.json({ point: null, status: "error" }, { status: 429 });
  try {
    const [hit] = await suggestAddresses([title, place].filter(Boolean).join(", "), city, { limit: 1 });
    return NextResponse.json(hit
      ? { point: { lat: hit.lat, lon: hit.lon }, status: "ok" }
      : { point: null, status: "not_found" });
  } catch (e) {
    console.error("[geo/resolve]", (e as Error).message);
    return NextResponse.json({ point: null, status: "error" });
  }
}
