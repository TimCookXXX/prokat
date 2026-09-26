import { NextResponse, type NextRequest } from "next/server";
import {
  SID_COOKIE, SID_MAX_AGE, UTM_COOKIE, UTM_MAX_AGE, isValidSid, utmFromSearch,
} from "@/lib/compare/visitor";

// Маршруты, на которые анон не должен попадать вообще (префикс-match).
// Кабинет владельца добавится следующим этапом.
const PROTECTED_PREFIXES: string[] = ["/requests", "/profile", "/cabinet", "/admin", "/moy-prokat"];

// Auth.js v5 в production использует префикс `__Secure-`, в dev — голый.
// Имя самой cookie — `authjs.session-token` (NextAuth v5 переименовал из next-auth).
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
}

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`));
}

// Edge middleware без обращения к БД. Делает три дела:
// 1) Прокидывает x-pathname в RSC (для layout'ов, которым нужен текущий URL).
// 2) Проверяет ПРИСУТСТВИЕ session-cookie на protected-роутах — это убирает
//    вспышку UI при анонимном заходе на /drafts. Валидность cookie проверит
//    page-level requireAuthState() (defence-in-depth для протухших сессий).
// 3) Метит посетителя для учёта обращений: анонимный id и UTM-метки захода.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isProtected(pathname) && !hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?from=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  const res = NextResponse.next({ request: { headers } });

  if (!isValidSid(req.cookies.get(SID_COOKIE)?.value)) {
    res.cookies.set(SID_COOKIE, crypto.randomUUID(), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: SID_MAX_AGE,
      secure: req.nextUrl.protocol === "https:",
    });
  }
  // Метки последнего рекламного захода: обращение атрибутируется ему.
  const utm = utmFromSearch(req.nextUrl.searchParams);
  if (utm) {
    res.cookies.set(UTM_COOKIE, JSON.stringify(utm), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: UTM_MAX_AGE,
      secure: req.nextUrl.protocol === "https:",
    });
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/.*|manifest\\.webmanifest).*)",
  ],
};
