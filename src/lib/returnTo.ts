/**
 * A dónde volver tras pagar. Se guarda en una cookie firmada porque el
 * retorno de Izipay es un POST desde su dominio (sin acceso a la sesión).
 * SameSite=None: con Lax el navegador no manda la cookie en ese POST cruzado.
 */
import { cookies } from "next/headers";
import { makeToken, readToken } from "./crypto";

const COOKIE = "web_pay_return";

/** Solo rutas internas: evita redirecciones abiertas (//evil.com, /\evil.com, http://...). */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const p = raw.trim().slice(0, 300);
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\") || /[\r\n]/.test(p)) return "/";
  return p;
}

export async function rememberReturnTo(orderId: string, path: string) {
  (await cookies()).set(COOKIE, makeToken({ orderId, path }, 2 * 60 * 60), {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 2 * 60 * 60,
  });
}

export async function takeReturnTo(orderId: string | undefined): Promise<string> {
  const jar = await cookies();
  const data = readToken<{ orderId?: string; path?: string }>(jar.get(COOKIE)?.value);
  if (!data || !orderId || data.orderId !== orderId) return "/";
  return safeReturnPath(data.path);
}

export function withQuery(path: string, key: string, value: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(value)}`;
}
