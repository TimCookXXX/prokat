// Подсказки адресов для поля «Где» (ТЗ, п. 3.3): через сервер, с кэшем и
// ограничением частоты. Без ключей геокодера — пустой список.
import { NextResponse, type NextRequest } from "next/server";
import { suggestAddresses } from "@/server/geocoder";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 120);
  const city = req.nextUrl.searchParams.get("city") ?? "krasnodar";
  if (!/^[a-z-]{2,40}$/.test(city)) return NextResponse.json({ items: [] }, { status: 400 });
  if (!checkLimit(clientIp(req.headers), "geo").ok) return NextResponse.json({ items: [] }, { status: 429 });
  return NextResponse.json({ items: await suggestAddresses(q, city) });
}
