// Координаты выбранной подсказки адреса (uri Геосаджеста) — для расстояний.
import { NextResponse, type NextRequest } from "next/server";
import { geocodeUri } from "@/server/geocoder";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const uri = req.nextUrl.searchParams.get("uri") ?? "";
  if (!uri.startsWith("ymapsbm1://") || uri.length > 500) return NextResponse.json({ point: null }, { status: 400 });
  if (!checkLimit(clientIp(req.headers), "geo").ok) return NextResponse.json({ point: null }, { status: 429 });
  return NextResponse.json({ point: await geocodeUri(uri) });
}
