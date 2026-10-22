/**
 * Login con Google para la herramienta web. Mismo patrón que
 * license-server/src/lib/google-auth.ts, adaptado para crear/actualizar
 * la fila en `web_users` (créditos, etc.) en vez de solo guardar email/nombre.
 */
import { cookies } from "next/headers";
import { makeToken, readToken } from "./crypto";
import { siteUrl } from "./config";
import { db, type WebUser } from "./db";
import { getAppSettings } from "./appSettings";
import { addCredits } from "./credits";
import { notifyAdmin, notifyUser } from "./notify";

export const WEB_SESSION_COOKIE = "web_session";
const STATE_COOKIE = "web_g_state";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 días

export type WebAuthUser = { id: string; email: string; name: string; credits: number; freeCredits: number; sessionVersion?: number };

function toAuthUser(row: WebUser): WebAuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    credits: row.credits,
    freeCredits: row.free_credits ?? 0,
    sessionVersion: typeof row.session_version === "number" ? row.session_version : undefined,
  };
}

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

/**
 * Créditos de bienvenida solo para cuentas NUEVAS y solo si desde esa IP
 * no se registraron ya `max_signups_per_ip` cuentas — así nadie junta
 * respuestas gratis abriendo varias cuentas de Google desde la misma
 * conexión. Sin IP conocida no se regala nada (no se puede verificar).
 */
async function signupBonus(ip: string): Promise<number> {
  if (!ip) return 0;
  const settings = await getAppSettings();
  if (settings.free_signup_credits <= 0) return 0;
  const { count, error } = await db()
    .from("web_users")
    .select("id", { count: "exact", head: true })
    .eq("signup_ip", ip);
  if (error) return 0;
  return (count ?? 0) < settings.max_signups_per_ip ? settings.free_signup_credits : 0;
}

/** Reclama los regalos de créditos pendientes para este correo (cada uno una sola vez). */
async function claimPendingGrants(userId: string, email: string): Promise<void> {
  const supa = db();
  const { data: pending } = await supa
    .from("web_credit_grants")
    .select("id")
    // eq (no ilike): "_" y "%" son comodines en ilike y un correo como
    // a_b@x.com reclamaría el regalo de acb@x.com. El admin guarda en minúsculas.
    .eq("email", email)
    .is("claimed_at", null);
  for (const g of pending ?? []) {
    // Claim condicional: solo gana una petición aunque haya dos logins a la vez.
    const { data: claimed } = await supa
      .from("web_credit_grants")
      .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
      .eq("id", g.id)
      .is("claimed_at", null)
      .select("credits")
      .maybeSingle<{ credits: number }>();
    if (claimed?.credits) {
      await addCredits(userId, claimed.credits);
      await notifyUser(userId, {
        kind: "gift",
        title: `Recibiste ${claimed.credits} créditos de regalo`,
        body: "Ya están en tu saldo.",
        link: "/mi-cuenta",
      });
    }
  }
}

/** Intercambia el code, crea/actualiza web_users y devuelve el usuario. */
export async function completeGoogleLogin(code: string, ip = ""): Promise<WebAuthUser | null> {
  const profile = await exchangeCode(code);
  if (!profile) return null;

  const supa = db();
  const email = profile.email.toLowerCase();
  const { data: existing } = await supa
    .from("web_users")
    .select("*")
    .eq("google_sub", profile.sub)
    .maybeSingle<WebUser>();

  let userId: string;
  if (existing) {
    userId = existing.id;
    await supa
      .from("web_users")
      .update({ last_login_at: new Date().toISOString(), email, name: profile.name || existing.name })
      .eq("id", existing.id);
  } else {
    const bonus = await signupBonus(ip);
    const { data: created, error } = await supa
      .from("web_users")
      .insert({
        google_sub: profile.sub,
        email,
        name: profile.name || "",
        signup_ip: ip,
        free_credits: bonus,
        free_grant_used: bonus > 0,
      })
      .select()
      .single<WebUser>();
    if (error || !created) return null;
    userId = created.id;
    await notifyAdmin({
      kind: "signup",
      title: "Nuevo usuario",
      body: `${email} se registró${bonus > 0 ? ` y recibió ${bonus} respuestas gratis` : " (sin regalo: IP ya usada)"}.`,
      link: "/admin#web-users",
    });
  }

  try {
    await claimPendingGrants(userId, email);
  } catch (e) {
    console.error("[googleAuth] no se pudieron reclamar regalos de créditos:", e);
  }

  const { data: row } = await supa.from("web_users").select("*").eq("id", userId).single<WebUser>();
  if (!row) return null;

  // Una sola sesión activa por cuenta: cada inicio de sesión sube la versión y
  // la sesión anterior (otro navegador u otro dispositivo) deja de valer.
  if (typeof row.session_version === "number") {
    const next = row.session_version + 1;
    await supa.from("web_users").update({ session_version: next }).eq("id", userId);
    row.session_version = next;
  }
  return toAuthUser(row);
}

export async function setWebSession(u: WebAuthUser) {
  const jar = await cookies();
  jar.set(WEB_SESSION_COOKIE, makeToken({ id: u.id, email: u.email, name: u.name, sv: u.sessionVersion ?? 0 }, SESSION_TTL), {
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
  const data = readToken<{ id?: string; email?: string; name?: string; sv?: number }>(jar.get(WEB_SESSION_COOKIE)?.value);
  if (!data?.id) return null;
  const { data: row } = await db().from("web_users").select("*").eq("id", data.id).maybeSingle<WebUser>();
  if (!row) return null;
  // Se inició sesión en otro lado después de esta: esta sesión ya no vale.
  if (typeof row.session_version === "number" && (data.sv ?? 0) !== row.session_version) return null;
  return toAuthUser(row);
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
