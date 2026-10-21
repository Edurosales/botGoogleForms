import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { getAppSettings } from "@/lib/appSettings";
import { applyDiscount, checkDiscountCoupon, normalizeCouponCode } from "@/lib/coupons";
import { rateLimit } from "@/lib/ratelimit";

/** Previsualiza el descuento de un cupón sobre un paquete (no consume usos). */
export async function GET(request: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, reason: "Inicia sesión con Google." }, { status: 401 });
  if (!rateLimit(`web-coupon-validate:${user.id}`, 20, 10 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  }

  const url = new URL(request.url);
  const code = normalizeCouponCode(url.searchParams.get("code"));
  const idx = Number(url.searchParams.get("packageIndex"));
  const settings = await getAppSettings();
  const pkg = Number.isInteger(idx) ? settings.credit_packages[idx] : undefined;
  if (!pkg) return NextResponse.json({ ok: false, reason: "Paquete no válido." }, { status: 400 });

  const check = await checkDiscountCoupon(code, user.email);
  if (!check.ok) {
    return NextResponse.json({ ok: false, reason: check.reason, originalCents: pkg.priceCents, finalCents: pkg.priceCents });
  }
  return NextResponse.json({
    ok: true,
    discountPercent: check.discountPercent,
    originalCents: pkg.priceCents,
    finalCents: applyDiscount(pkg.priceCents, check.discountPercent),
    description: check.coupon.description,
  });
}
