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

export function proxy(request: NextRequest): NextResponse {
  const token = request.cookies.get(TOKEN_KEY)?.value ?? null;

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
