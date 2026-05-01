"use client";

const KEY = "plana.session";

export type Session = {
  email: string;
  name: string;
  loggedAt: number;
};

export function signIn(email: string): Session {
  const name = email.split("@")[0]
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Архитектор";
  const session: Session = { email, name, loggedAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(session));
  return session;
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function signOut() {
  localStorage.removeItem(KEY);
}
