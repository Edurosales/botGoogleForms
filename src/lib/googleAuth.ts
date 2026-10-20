/**
 * Login con Google para la herramienta web. Mismo patrón que
 * license-server/src/lib/google-auth.ts, adaptado para crear/actualizar
 * la fila en `web_users` (créditos, etc.) en vez de solo guardar email/nombre.
 */
import { cookies } from "next/headers";
import { makeToken, readToken } from "./crypto";
import { siteUrl } from "./config";
import { db, type WebUser } from "./db";

export const WEB_SESSION_COOKIE = "web_session";
const STATE_COOKIE = "web_g_state";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 días

export type WebAuthUser = { id: string; email: string; name: string; credits: number };

export function redirectUri(): string {
  return `${siteUrl()}/api/auth/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type GoogleProfile = { sub: string; email: string; email_verified?: boolean; name?: string };

async function exchangeCode(code: string): Promise<GoogleProfile | null> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const tok = (await r.json()) as { access_token?: string };
  if (!tok.access_token) return null;

  const u = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
    cache: "no-store",
  });
  const info = (await u.json()) as GoogleProfile;
  if (!info.sub || !info.email || !info.email_verified) return null;
  return info;
}

/** Intercambia el code, crea/actualiza web_users y devuelve el usuario. */
export async function completeGoogleLogin(code: string): Promise<WebAuthUser | null> {
  const profile = await exchangeCode(code);
  if (!profile) return null;

  const supa = db();
  const { data: existing } = await supa
    .from("web_users")
    .select("*")
    .eq("google_sub", profile.sub)
    .maybeSingle<WebUser>();

  let user: WebUser | null = existing ?? null;
  if (user) {
    await supa
      .from("web_users")
      .update({ last_login_at: new Date().toISOString(), email: profile.email.toLowerCase(), name: profile.name || user.name })
      .eq("id", user.id);
  } else {
    const { data: created, error } = await supa
      .from("web_users")
      .insert({ google_sub: profile.sub, email: profile.email.toLowerCase(), name: profile.name || "" })
      .select()
      .single<WebUser>();
    if (error || !created) return null;
    user = created;
  }

  return { id: user.id, email: user.email, name: user.name, credits: user.credits };
}

export async function setWebSession(u: WebAuthUser) {
  const jar = await cookies();
  jar.set(WEB_SESSION_COOKIE, makeToken({ id: u.id, email: u.email, name: u.name }, SESSION_TTL), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function clearWebSession() {
  (await cookies()).delete(WEB_SESSION_COOKIE);
}

/** Usuario de la sesión, con el saldo de créditos RE-LEÍDO de la base (no del cookie, que puede estar viejo). */
export async function getWebUser(): Promise<WebAuthUser | null> {
  const jar = await cookies();
  const data = readToken<{ id?: string; email?: string; name?: string }>(jar.get(WEB_SESSION_COOKIE)?.value);
  if (!data?.id) return null;
  const { data: row } = await db().from("web_users").select("*").eq("id", data.id).maybeSingle<WebUser>();
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, credits: row.credits };
}

export async function setStateCookie(state: string) {
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
}

export async function takeStateCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const v = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  return v;
}
