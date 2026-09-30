// Подсказки адресов «Где» (ТЗ, п. 3.3) своим геокодером (src/server/geocoder.ts): сразу с
// координатами и точностью — второго запроса за точкой нет. Ответ зависит только от
// параметров и версии данных, поэтому кэшируется. Лимит частоты — от выкачивания базы адресов.
import { NextResponse, type NextRequest } from "next/server";
import { suggestAddresses, SUGGEST_LIMIT } from "@/server/geocoder";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { parseCity, parseNear } from "@/lib/http/geo-params";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // полный адрес ФИАС / маркетплейса бывает длиннее 120 знаков («Россия, 350000, Краснодарский край, городской округ
  // город Краснодар, …, ул. Российская, д. 267/4») — обрезать только совсем длинное; слов движок берёт не больше 24
  const q = (sp.get("q") ?? "").slice(0, 300);
  const city = parseCity(sp.get("city"));
  const limitRaw = Number(sp.get("limit") ?? SUGGEST_LIMIT);
  const limit = Number.isInteger(limitRaw) ? Math.min(10, Math.max(1, limitRaw)) : SUGGEST_LIMIT;
  if (!city) return NextResponse.json({ items: [] }, { status: 400 });
  if (!checkLimit(clientIp(req.headers), "geo").ok) return NextResponse.json({ items: [] }, { status: 429 });
  try {
    const items = await suggestAddresses(q, city, { near: parseNear(sp.get("near")), limit });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    console.error("[geo/suggest]", (e as Error).message);
    return NextResponse.json({ items: [], error: "unavailable" }, { status: 503 });
  }
}
