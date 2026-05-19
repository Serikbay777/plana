"use client";

const TOKEN_KEY = "plana.token";
const SESSION_KEY = "plana.session";

export type Session = {
  email: string;
  name: string;
  loggedAt: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = decodeTokenPayload(token);
  if (!payload || typeof payload.exp !== "number") return true;
  return payload.exp * 1000 < Date.now();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function signIn(email: string, password: string): Promise<Session> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    let detail = "Ошибка входа";
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }

  const data = await res.json() as { access_token: string; email: string; name: string };
  localStorage.setItem(TOKEN_KEY, data.access_token);

  const session: Session = { email: data.email, name: data.name, loggedAt: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function register(email: string, password: string): Promise<Session> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    let detail = "Ошибка регистрации";
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }

  const data = await res.json() as { access_token: string; email: string; name: string };
  localStorage.setItem(TOKEN_KEY, data.access_token);

  const session: Session = { email: data.email, name: data.name, loggedAt: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || isTokenExpired(token)) {
    if (token) signOut();
    return null;
  }
  return token;
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  if (!getToken()) return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function signOut(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}
