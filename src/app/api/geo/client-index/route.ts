// Мини-индекс «Где» для браузера: улицы, населённые пункты, микрорайоны и объекты без домов
// (≈ 0,9 МБ, gzip ≈ 250 КБ — сжимает Caddy). По нему поле подсказывает мгновенно, без сети;
// дома — с /api/geo/suggest. ETag — метка версии данных; ссылка с ?v=<метка> (её отдаёт
// страница) кэшируется навсегда: новые данные — новая метка и новая ссылка.
// Выборка производная от OSM и раздаётся по ODbL: лицензия и источники — в самом JSON (license,
// attribution) и в заголовке Link rel="license".
import { NextResponse, type NextRequest } from "next/server";
import { clientIndexJson } from "@/server/geocoder";
import { parseCity } from "@/lib/http/geo-params";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const city = parseCity(req.nextUrl.searchParams.get("city"));
  if (!city) return NextResponse.json({ error: "bad_city" }, { status: 400 });
  let index: Awaited<ReturnType<typeof clientIndexJson>>;
  try {
    index = await clientIndexJson(city);
  } catch (e) {
    console.error("[geo/client-index]", (e as Error).message);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!index) return NextResponse.json({ error: "no_addresses" }, { status: 404 });
  const etag = `"${index.token}"`;
  const versioned = req.nextUrl.searchParams.get("v") === index.token;
  const headers = {
    ETag: etag,
    Link: '<https://opendatacommons.org/licenses/odbl/1-0/>; rel="license"',
    "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
  };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(index.json, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}
