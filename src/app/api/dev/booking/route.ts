import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { cancelBookingRequest, createBookingRequest } from "@/server/actions/booking";
import {
  confirmRequest, declineRequest, completeRequest, noShowRequest, setBlockedDates,
} from "@/server/actions/owner";

// Dev-only обвязка над server actions заявок: позволяет гонять e2e-флоу
// curl'ом без браузера (у actions нет стабильного HTTP-протокола снаружи).
// Жёсткий kill-switch по NODE_ENV, как у /api/dev/login.
//
// POST /api/dev/booking  { action: "create", ...formFields } | { action: "cancel", requestId }

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (getEnv().NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  if (body.action === "create") {
    return NextResponse.json(await createBookingRequest(body));
  }
  if (body.action === "cancel" && typeof body.requestId === "string") {
    return NextResponse.json(await cancelBookingRequest(body.requestId));
  }
  // Действия владельца (нужна сессия владельца вещи).
  if (typeof body.requestId === "string") {
    if (body.action === "confirm") return NextResponse.json(await confirmRequest(body.requestId));
    if (body.action === "decline") return NextResponse.json(await declineRequest(body.requestId));
    if (body.action === "complete") return NextResponse.json(await completeRequest(body.requestId));
    if (body.action === "no_show") return NextResponse.json(await noShowRequest(body.requestId));
  }
  if (body.action === "block" && typeof body.listingId === "string") {
    return NextResponse.json(await setBlockedDates(body.listingId, body.from, body.to, body.qty));
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
