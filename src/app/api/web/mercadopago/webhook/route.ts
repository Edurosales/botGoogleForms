import { NextResponse } from "next/server";
import { verifyWebhookSignature, mpConfigured } from "@/lib/mercadopago";
import { processMercadoPagoPayment } from "@/lib/mpFulfill";
import { audit } from "@/lib/audit";

/**
 * Webhook de Mercado Pago (configurar en Tus integraciones → Webhooks, evento
 * "Pagos"): https://bot-google-forms-servicio.vercel.app/api/web/mercadopago/webhook
 *
 * Responde 200 rápido para que no reintente; 401 si la firma no cuadra; 500
 * si falló algo nuestro (así Mercado Pago lo reintenta más tarde).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; action?: string; data?: { id?: string | number } };
  const type = body.type || url.searchParams.get("type") || url.searchParams.get("topic") || "";
  const dataId = String(url.searchParams.get("data.id") ?? body.data?.id ?? url.searchParams.get("id") ?? "");

  const signature = verifyWebhookSignature(req.headers, dataId);
  if (signature === false) {
    await audit({ action: "payment.webhook_bad_signature", level: "security", target: dataId, details: { provider: "mercadopago", type } });
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Solo nos interesan los pagos (compras y devoluciones).
  if (type !== "payment" || !/^\d{1,20}$/.test(dataId) || !mpConfigured()) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  try {
    const r = await processMercadoPagoPayment(dataId);
    return NextResponse.json({ ok: true, result: r.reason ?? (r.ok ? "acreditado" : "sin cambios") });
  } catch (e) {
    console.error("[mercadopago] webhook:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
