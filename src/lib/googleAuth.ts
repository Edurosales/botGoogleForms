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
import { createHash, randomBytes } from "node:crypto";
import { onlyExisting } from "./schemaFlags";
import { audit } from "./audit";
import { recordConsent, TERMS_VERSION, type SignupChoices } from "./consent";
import { requestMeta } from "./requestMeta";

export const WEB_SESSION_COOKIE = "web_session";
const STATE_COOKIE = "web_g_state";
const CHOICES_COOKIE = "web_g_choices";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 días

export type WebAuthUser = {
  id: string;
  email: string;
  name: string;
  credits: number;
  freeCredits: number;
  sessionVersion?: number;
  /** Aceptó la versión vigente de Términos y Privacidad. */
  termsOk: boolean;
  marketing: boolean;
  country: string;
  countryOptIn: boolean;
  /** Cuenta bloqueada por el admin: motivo que ve la persona (vacío = activa). */
  bannedReason: string;
  /** Compras bloqueadas para esta cuenta (motivo). */
  purchasesBlockedReason: string;
};

/** Hash del correo (para recordar cuentas borradas sin guardar el correo). */
export function emailHash(email: string): string {
  return createHash("sha256").update(`formsbot:${email.trim().toLowerCase()}`).digest("hex");
}

function toAuthUser(row: WebUser): WebAuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    credits: row.credits,
    freeCredits: row.free_credits ?? 0,
    sessionVersion: typeof row.session_version === "number" ? row.session_version : undefined,
    // Sin la columna (SQL de la ronda sin correr) no se bloquea a nadie.
    termsOk: row.terms_version === undefined ? true : row.terms_version === TERMS_VERSION,
    marketing: row.marketing_opt_in ?? false,
    country: row.country ?? "",
    countryOptIn: row.country_opt_in ?? false,
    bannedReason: row.banned_at ? row.ban_reason || "Tu cuenta fue bloqueada." : "",
    purchasesBlockedReason: row.purchases_blocked ? row.purchases_block_reason || "Las compras están bloqueadas para tu cuenta." : "",
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

type GoogleProfile = { sub: string; email: string; email_verified?: boolean; name?: string; given_name?: string; family_name?: string };

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
async function signupBonus(ip: string, email: string): Promise<number> {
  if (!ip) return 0;
  // Ya tuvo una cuenta y la borró: no se regala otra vez.
  const { data: wasDeleted } = await db()
    .from("web_deleted_accounts")
    .select("email_hash")
    .eq("email_hash", emailHash(email))
    .maybeSingle();
  if (wasDeleted) return 0;
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

/** Nombre y apellido tal como los da Google (para pagos: siempre iguales). */
async function namePatch(profile: GoogleProfile): Promise<Record<string, unknown>> {
  return onlyExisting(
    "web_users",
    { given_name: (profile.given_name || "").slice(0, 80), family_name: (profile.family_name || "").slice(0, 80) },
    ["given_name", "family_name"]
  );
}

export type LoginResult = { user: WebAuthUser } | { error: "google" | "terms" };

/** Campos de consentimiento que se guardan en web_users al aceptar. */
async function consentPatch(choices: SignupChoices | null, current?: WebUser): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (choices?.terms && current?.terms_version !== TERMS_VERSION) {
    patch.terms_version = TERMS_VERSION;
    patch.terms_accepted_at = now;
  }
  if (choices?.marketing && !current?.marketing_opt_in) {
    patch.marketing_opt_in = true;
    patch.marketing_opt_in_at = now;
  }
  if (choices?.country) {
    const { country } = await requestMeta();
    if (country) {
      patch.country = country;
      patch.country_opt_in = true;
    }
  }
  if (!current?.unsubscribe_token) patch.unsubscribe_token = randomBytes(24).toString("base64url");
  return onlyExisting("web_users", patch, [
    "terms_version",
    "terms_accepted_at",
    "marketing_opt_in",
    "marketing_opt_in_at",
    "country",
    "country_opt_in",
    "unsubscribe_token",
  ]);
}

async function recordChoices(userId: string, email: string, choices: SignupChoices | null, current?: WebUser) {
  const u = { id: userId, email };
  if (choices?.terms && current?.terms_version !== TERMS_VERSION) await recordConsent(u, "terms", true, { via: "signin", age_16_or_more: true });
  if (choices?.marketing && !current?.marketing_opt_in) await recordConsent(u, "marketing", true, { via: "signin" });
  if (choices?.country) await recordConsent(u, "country", true, { via: "signin" });
}

/**
 * Intercambia el code, crea/actualiza web_users y devuelve el usuario.
 * Una cuenta NUEVA solo se crea si aceptó Términos y Privacidad antes de ir
 * a Google (`choices.terms`): sin eso no se guarda ningún dato suyo.
 */
export async function completeGoogleLogin(code: string, ip = "", choices: SignupChoices | null = null): Promise<LoginResult> {
  const profile = await exchangeCode(code);
  if (!profile) {
    await audit({ action: "auth.login_failed", level: "warn", details: { why: "google" } });
    return { error: "google" };
  }

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
      .update({
        last_login_at: new Date().toISOString(),
        email,
        name: profile.name || existing.name,
        ...(await namePatch(profile)),
        ...(await consentPatch(choices, existing)),
      })
      .eq("id", existing.id);
    await recordChoices(userId, email, choices, existing);
    await audit({ action: "auth.login", userId, email });
  } else {
    if (!choices?.terms) {
      await audit({ action: "auth.signup_blocked", level: "warn", email, details: { why: "terms_not_accepted" } });
      return { error: "terms" };
    }
    const bonus = await signupBonus(ip, email);
    const { data: created, error } = await supa
      .from("web_users")
      .insert({
        google_sub: profile.sub,
        email,
        name: profile.name || "",
        signup_ip: ip,
        free_credits: bonus,
        free_grant_used: bonus > 0,
        ...(await namePatch(profile)),
        ...(await consentPatch(choices)),
      })
      .select()
      .single<WebUser>();
    if (error || !created) {
      await audit({ action: "auth.signup_failed", level: "error", email, details: { error: error?.message } });
      return { error: "google" };
    }
    userId = created.id;
    await recordChoices(userId, email, choices);
    await audit({ action: "auth.signup", userId, email, details: { bonus, marketing: choices.marketing, country: choices.country } });
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
  if (!row) return { error: "google" };

  // Una sola sesión activa por cuenta: cada inicio de sesión sube la versión y
  // la sesión anterior (otro navegador u otro dispositivo) deja de valer.
  if (typeof row.session_version === "number") {
    const next = row.session_version + 1;
    await supa.from("web_users").update({ session_version: next }).eq("id", userId);
    row.session_version = next;
  }
  return { user: toAuthUser(row) };
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
  if (!row || row.deleted_at) return null;
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

/** Lo que la persona marcó (términos / novedades / país) antes de ir a Google. */
export async function setChoicesCookie(value: string) {
  (await cookies()).set(CHOICES_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
}

export async function takeChoicesCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const v = jar.get(CHOICES_COOKIE)?.value;
  jar.delete(CHOICES_COOKIE);
  return v;
}

export async function takeStateCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const v = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  return v;
}
