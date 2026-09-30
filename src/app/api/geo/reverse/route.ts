// Обратный геокодер: точка «Моё местоположение» → подпись адреса («улица Красная, 162Б»).
// Дом не дальше 60 м, иначе улица, иначе населённый пункт; далеко от всего — hit: null.
import { NextResponse, type NextRequest } from "next/server";
import { reverseGeocode } from "@/server/geocoder";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { parseCity, parsePoint } from "@/lib/http/geo-params";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const city = parseCity(sp.get("city"));
  const point = parsePoint(sp.get("lat"), sp.get("lon"));
  if (!city || !point) return NextResponse.json({ hit: null }, { status: 400 });
  if (!checkLimit(clientIp(req.headers), "geo").ok) return NextResponse.json({ hit: null }, { status: 429 });
  try {
    return NextResponse.json({ hit: await reverseGeocode(point, city) });
  } catch (e) {
    console.error("[geo/reverse]", (e as Error).message);
    return NextResponse.json({ hit: null, error: "unavailable" }, { status: 503 });
  }
}
