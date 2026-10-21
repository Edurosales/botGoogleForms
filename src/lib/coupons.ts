/**
 * Cupones de DESCUENTO del servicio web (los de "regalo de créditos" se
 * canjean con la función SQL web_redeem_coupon, todo en una transacción).
 */
import { db, type WebCoupon } from "./db";

export type DiscountCheck =
  | { ok: true; coupon: WebCoupon; discountPercent: number }
  | { ok: false; reason: string };

/** Patrón para ilike que coincide EXACTO (sin mayúsculas/minúsculas): escapa los comodines. */
function exactIlike(code: string): string {
  return code.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function normalizeCouponCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 40) : "";
}

/** Valida un cupón de descuento para este usuario. No consume usos. */
export async function checkDiscountCoupon(code: string, email: string): Promise<DiscountCheck> {
  if (!code) return { ok: false, reason: "Escribe un cupón." };
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) return { ok: false, reason: "Cupón no válido." };

  const { data: coupon } = await db()
    .from("web_coupons")
    .select("*")
    .ilike("code", exactIlike(code))
    .maybeSingle<WebCoupon>();

  if (!coupon || !coupon.is_active || coupon.code.toLowerCase() !== code.toLowerCase()) {
    return { ok: false, reason: "Cupón no válido." };
  }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "Este cupón ya expiró." };
  }
  if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) {
    return { ok: false, reason: "Este cupón ya se agotó." };
  }
  if (coupon.allowed_email && coupon.allowed_email.toLowerCase() !== email.toLowerCase()) {
    return { ok: false, reason: "Este cupón no es para tu cuenta." };
  }
  if (!coupon.discount_percent || coupon.discount_percent <= 0) {
    return {
      ok: false,
      reason: coupon.credits > 0 ? "Este cupón regala créditos: canjéalo en Mi cuenta." : "Cupón no válido.",
    };
  }
  return { ok: true, coupon, discountPercent: Math.min(90, coupon.discount_percent) };
}

export function applyDiscount(cents: number, percent: number): number {
  // Izipay rechaza montos muy bajos; nunca bajar de S/ 1.00.
  return Math.max(100, Math.round(cents * (1 - percent / 100)));
}

/** Suma un uso al cupón con control optimista (sin función SQL dedicada). */
export async function incrementCouponUse(code: string): Promise<void> {
  if (!code) return;
  const supa = db();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: c } = await supa
      .from("web_coupons")
      .select("id, uses")
      .ilike("code", exactIlike(code))
      .maybeSingle<{ id: string; uses: number }>();
    if (!c) return;
    const { data: updated } = await supa
      .from("web_coupons")
      .update({ uses: c.uses + 1 })
      .eq("id", c.id)
      .eq("uses", c.uses)
      .select("id")
      .maybeSingle();
    if (updated) return;
  }
  console.error("[coupons] no se pudo sumar el uso del cupón tras varios intentos:", code);
}
