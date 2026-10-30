import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/config";
import { getAppSettings } from "@/lib/appSettings";
import { normalizeCode, REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS, referrerExists } from "@/lib/referrals";

/**
 * /r/CODIGO → enlace de invitación. Guarda el código en una cookie httpOnly
 * (el navegador no puede leerla ni cambiarla desde JavaScript) y manda a la
 * portada. El código solo se usa si la persona CREA una cuenta. Un código
 * inválido, o el programa apagado, simplemente lleva a la portada.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const home = NextResponse.redirect(`${siteUrl()}/?invitado=1`);
  if (!rateLimit(`ref-link:${clientIp(req)}`, 30, 10 * 60_000)) return NextResponse.redirect(`${siteUrl()}/`);
  const code = normalizeCode((await ctx.params).code);
  if (!code) return NextResponse.redirect(`${siteUrl()}/`);
  const settings = await getAppSettings();
  if (!settings.referral_enabled || !(await referrerExists(code))) return NextResponse.redirect(`${siteUrl()}/`);
  home.cookies.set(REFERRAL_COOKIE, code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.min(365, Math.max(1, settings.referral_cookie_days ?? REFERRAL_COOKIE_DAYS)) * 86400,
  });
  return home;
}
