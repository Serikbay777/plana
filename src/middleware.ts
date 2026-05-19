import { NextRequest, NextResponse } from "next/server";

const TOKEN_KEY = "plana.token";

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp !== "number" || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const token = request.cookies.get(TOKEN_KEY)?.value
    ?? request.headers.get("x-plana-token")
    ?? null;

  // Токен может храниться только в localStorage (клиентская сторона),
  // поэтому middleware не может его прочитать напрямую.
  // Вместо блокировки на сервере — редиректим на /login только если
  // заголовок x-plana-token явно указывает на инвалидный токен.
  // Основная защита — клиентский auth gate в app/page.tsx (getSession()).
  // Здесь мы лишь отсекаем явно невалидные токены переданные через cookie.

  if (token && isTokenExpired(token)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
