import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/appSettings";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { createPayment, izipayPublicKey, izipayStaticUrl } from "@/lib/izipay";
import { siteUrl } from "@/lib/config";
import { CREDIT_PURCHASE_CHECKS } from "@/lib/webLegal";

/**
 * Crea la orden de créditos + formToken de Izipay.
 * No se pudo probar en vivo en esta sesión (faltan credenciales Izipay en
 * este entorno) — mismo patrón ya en producción en license-server/api/checkout/create.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`web-checkout:${ip}`, 8, 10 * 60_000)) {
    return NextResponse.json({ message: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  }

  const user = await getWebUser();
  if (!user) return NextResponse.json({ message: "Inicia sesión con Google para comprar." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { responses?: number; checks?: string[] };
  const checks = Array.isArray(body.checks) ? body.checks : [];
  const missing = CREDIT_PURCHASE_CHECKS.filter((c) => !checks.includes(c.id));
  if (missing.length) {
    return NextResponse.json({ message: "Debes aceptar todas las condiciones para continuar." }, { status: 400 });
  }

  const settings = await getAppSettings();
  const pkg = settings.credit_packages.find((p) => p.responses === body.responses);
  if (!pkg) return NextResponse.json({ message: "Paquete de créditos no válido." }, { status: 400 });

  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const orderId = `WB-${ymd}-${randomBytes(3).toString("hex").toUpperCase()}`;

  const { error: insertError } = await db().from("web_credit_orders").insert({
    order_id: orderId,
    user_id: user.id,
    credits: pkg.responses,
    amount_cents: pkg.priceCents,
    currency: "PEN",
    status: "pending",
  });
  if (insertError) {
    return NextResponse.json({ message: `No se pudo crear la orden: ${insertError.message}` }, { status: 500 });
  }

  try {
    const formToken = await createPayment({
      amountCents: pkg.priceCents,
      currency: "PEN",
      orderId,
      email: user.email,
      name: user.name || user.email,
      ipnUrl: `${siteUrl()}/api/web/izipay/ipn`,
    });
    return NextResponse.json({
      orderId,
      formToken,
      publicKey: izipayPublicKey(),
      staticUrl: izipayStaticUrl(),
      returnUrl: `${siteUrl()}/api/web/izipay/return`,
    });
  } catch (e) {
    await db().from("web_credit_orders").update({ status: "failed" }).eq("order_id", orderId);
    console.error("[web-checkout]", e);
    return NextResponse.json({ message: "No se pudo iniciar el pago. Intenta de nuevo en unos minutos." }, { status: 502 });
  }
}
