/**
 * Consentimientos (RGPD art. 6–7): se guarda QUÉ aceptó cada persona, la
 * versión del texto, cuándo, desde qué IP y navegador. Es un historial que
 * no se edita: retirar un permiso agrega una fila con granted=false.
 */
import { db } from "./db";
import { requestMeta } from "./requestMeta";
import { audit } from "./audit";

/** Versión vigente de Términos + Privacidad. Cambiarla pide aceptar de nuevo. */
// 2026-10-22.2: se agregó la declaración de tener 16 años o más.
export const TERMS_VERSION = "2026-10-22.2";
export const MARKETING_VERSION = "2026-10-22";

export type ConsentKind = "terms" | "marketing" | "country" | "job_use";

export async function recordConsent(
  user: { id: string; email: string },
  kind: ConsentKind,
  granted: boolean,
  context: Record<string, unknown> = {},
  version = kind === "marketing" ? MARKETING_VERSION : TERMS_VERSION
): Promise<void> {
  const meta = await requestMeta();
  const { error } = await db()
    .from("web_consents")
    .insert({
      user_id: user.id,
      email: user.email.toLowerCase(),
      kind,
      granted,
      version,
      ip: meta.ip,
      user_agent: meta.userAgent,
      context,
    });
  if (error) console.warn(`[consent] ${kind}: ${error.message}`);
  await audit({
    action: `consent.${kind}.${granted ? "granted" : "withdrawn"}`,
    userId: user.id,
    email: user.email,
    details: { version, ...context },
    meta,
  });
}

/** Lo que eligió la persona antes de ir a Google (cookie corta, ver /api/auth/google). */
export type SignupChoices = { terms: boolean; marketing: boolean; country: boolean };

export function encodeChoices(c: SignupChoices): string {
  return `${c.terms ? 1 : 0}${c.marketing ? 1 : 0}${c.country ? 1 : 0}`;
}

export function decodeChoices(v: string | undefined | null): SignupChoices | null {
  if (!v || !/^[01]{3}$/.test(v)) return null;
  return { terms: v[0] === "1", marketing: v[1] === "1", country: v[2] === "1" };
}
