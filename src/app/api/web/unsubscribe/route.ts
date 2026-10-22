import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordConsent } from "@/lib/consent";
import { rateLimit } from "@/lib/ratelimit";
import { requestMeta } from "@/lib/requestMeta";

/**
 * Baja del boletín por token (sin iniciar sesión). Lo usan el botón de la
 * página /baja y el "Cancelar suscripción" de Gmail/Outlook (RFC 8058, que
 * hace POST a esta URL con ?t=).
 */
export async function POST(req: Request) {
  const meta = await requestMeta();
  if (!rateLimit(`unsub:${meta.ip}`, 30, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos." }, { status: 429 });
  }
  const url = new URL(req.url);
  let token = url.searchParams.get("t") ?? "";
  if (!token && (req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { t?: unknown };
    token = typeof body.t === "string" ? body.t : "";
  }
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) {
    return NextResponse.json({ ok: false, error: "Enlace de baja no válido." }, { status: 400 });
  }
  const supa = db();
  const { data: user } = await supa
    .from("web_users")
    .select("id,email,marketing_opt_in")
    .eq("unsubscribe_token", token)
    .maybeSingle<{ id: string; email: string; marketing_opt_in: boolean }>();
  // Misma respuesta exista o no: el enlace no sirve para averiguar correos.
  if (user?.marketing_opt_in) {
    await supa.from("web_users").update({ marketing_opt_in: false, marketing_opt_in_at: null }).eq("id", user.id);
    await recordConsent(user, "marketing", false, { via: "unsubscribe_link" });
  }
  return NextResponse.json({ ok: true });
}
