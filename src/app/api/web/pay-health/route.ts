import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { requestMeta } from "@/lib/requestMeta";
import { collectorInfo } from "@/lib/payGuard";
import { dlocalDiagnose } from "@/lib/dlocalgo";

/**
 * ¿A qué cuenta va el dinero? Muestra, enmascaradas (solo los últimos
 * dígitos), la cuenta de Mercado Pago y la tienda de Izipay conectadas en
 * este despliegue, para compararlas con las tuyas. Nunca devuelve claves.
 */
export async function GET() {
  const { ip } = await requestMeta();
  if (!rateLimit(`pay-health:${ip}`, 6, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Demasiadas consultas." }, { status: 429 });
  }
  const [info, dlocalgo] = await Promise.all([collectorInfo(), dlocalDiagnose()]);
  return NextResponse.json(
    {
      ok: !info.mercadopago.error,
      deployment: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7),
      mercadopago: info.mercadopago,
      izipay: info.izipay,
      // ¿Las claves de dLocal Go funcionan, y de qué entorno son? (sin mostrarlas)
      dlocalgo: { ...dlocalgo, key: info.dlocalgo.key },
      webhookSignature: Boolean((process.env.MP_WEBHOOK_SECRET || "").trim()),
      testPaymentsAllowed: process.env.MP_ALLOW_TEST_PAYMENTS === "true" || process.env.IZIPAY_ALLOW_TEST_PAYMENTS === "true",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
