import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { onlyExisting } from "@/lib/schemaFlags";
import { recordConsent, TERMS_VERSION } from "@/lib/consent";
import { requestMeta } from "@/lib/requestMeta";
import { rateLimit } from "@/lib/ratelimit";

/**
 * Cambia los permisos de la cuenta (ventana de aceptación y Mi cuenta).
 * Body: { terms?: true, marketing?: boolean, country?: boolean }.
 * Cada cambio queda en web_consents (dar Y retirar).
 */
export async function POST(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  if (!rateLimit(`consent:${user.id}`, 20, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Demasiados cambios seguidos." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { terms?: unknown; marketing?: unknown; country?: unknown };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (body.terms === true && !user.termsOk) {
    patch.terms_version = TERMS_VERSION;
    patch.terms_accepted_at = now;
    await recordConsent(user, "terms", true, { via: "gate" });
  }
  if (typeof body.marketing === "boolean" && body.marketing !== user.marketing) {
    patch.marketing_opt_in = body.marketing;
    patch.marketing_opt_in_at = body.marketing ? now : null;
    await recordConsent(user, "marketing", body.marketing, { via: "account" });
  }
  if (typeof body.country === "boolean" && body.country !== user.countryOptIn) {
    patch.country_opt_in = body.country;
    // Retirar el permiso borra el dato, no solo lo oculta.
    patch.country = body.country ? (await requestMeta()).country || null : null;
    await recordConsent(user, "country", body.country, { via: "account" });
  }

  const safe = await onlyExisting("web_users", patch, Object.keys(patch));
  if (Object.keys(safe).length) {
    const { error } = await db().from("web_users").update(safe).eq("id", user.id);
    if (error) return NextResponse.json({ ok: false, error: "No se pudo guardar." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
