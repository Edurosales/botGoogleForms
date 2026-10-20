/**
 * Primitivo de sesión HMAC. Mismo patrón que license-server/src/lib/crypto.ts
 * (duplicado a propósito: son dos apps/despliegues independientes).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta variable de entorno ${name}`);
  return v;
}

/** Token HMAC con expiración: base64url(json).base64url(hmac) */
export function makeToken(data: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  ).toString("base64url");
  const mac = createHmac("sha256", env("WEB_SESSION_SECRET")).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function readToken<T = Record<string, unknown>>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", env("WEB_SESSION_SECRET")).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
    return data as T;
  } catch {
    return null;
  }
}
