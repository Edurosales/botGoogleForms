import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { normalizeCouponCode } from "@/lib/coupons";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { notifyUser } from "@/lib/notify";

/** Canjea un cupón que regala créditos (transacción en SQL: web_redeem_coupon). */
export async function POST(request: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, reason: "Inicia sesión con Google para canjear." }, { status: 401 });
  if (!rateLimit(`web-redeem:${user.id}`, 8, 10 * 60_000) || !rateLimit(`web-redeem-ip:${clientIp(request)}`, 20, 10 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const code = normalizeCouponCode(body.code);
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) return NextResponse.json({ ok: false, reason: "Cupón no válido." }, { status: 400 });

  const { data, error } = await db().rpc("web_redeem_coupon", { p_code: code, p_user: user.id, p_email: user.email });
  if (error) {
    console.error("[coupons/redeem]", error.message);
    return NextResponse.json({ ok: false, reason: "No se pudo canjear el cupón ahora. Intenta de nuevo." }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok: boolean; message: string; credits_added: number; new_balance: number | null }
    | undefined;
  if (!row?.ok) return NextResponse.json({ ok: false, reason: row?.message || "Cupón no válido." }, { status: 400 });
  await notifyUser(user.id, {
    kind: "gift",
    title: `Cupón canjeado: +${row.credits_added} créditos`,
    body: `Usaste el cupón ${code.toUpperCase()}.`,
    link: "/mi-cuenta",
  });
  return NextResponse.json({ ok: true, message: row.message, creditsAdded: row.credits_added, credits: row.new_balance });
}
