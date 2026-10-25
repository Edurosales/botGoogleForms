import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";
import { getPayment } from "@/lib/mercadopago";
import { processMercadoPagoPayment } from "@/lib/mpFulfill";
import { takeReturnTo, withQuery } from "@/lib/returnTo";

/**
 * Vuelta desde Checkout Pro. Mercado Pago agrega ?payment_id=&status=&
 * external_reference=. Nunca se cree en esos parámetros: se consulta el pago
 * a la API (igual que el webhook, idempotente) y recién ahí se acredita.
 * Si fue rechazado, la tienda muestra el motivo real (status_detail).
 */
export async function GET(req: Request) {
  const site = siteUrl();
  const q = new URL(req.url).searchParams;
  const paymentId = q.get("payment_id") || q.get("collection_id") || "";
  const status = q.get("status") || q.get("collection_status") || "";
  const ref = q.get("external_reference") || "";

  if (!/^\d{1,20}$/.test(paymentId)) {
    // Volvió sin pagar (canceló o cerró): de vuelta a la tienda.
    return NextResponse.redirect(`${site}/comprar-creditos?mp=cancelado`, 303);
  }
  try {
    const r = await processMercadoPagoPayment(paymentId);
    if (r.ok && r.orderId) {
      const back = await takeReturnTo(r.orderId);
      return NextResponse.redirect(`${site}${withQuery(back, "pagado", r.orderId)}`, 303);
    }
    const p = await getPayment(paymentId);
    if (p.status === "pending" || p.status === "in_process") {
      return NextResponse.redirect(`${site}/comprar-creditos?mp=pendiente&pedido=${encodeURIComponent(ref)}`, 303);
    }
    if (p.status === "rejected" || p.status === "cancelled") {
      const detail = (p.status_detail || p.status).replace(/[^a-z_]/gi, "").slice(0, 60);
      return NextResponse.redirect(`${site}/comprar-creditos?mp=rechazado&motivo=${encodeURIComponent(detail)}`, 303);
    }
    // Aprobado en Mercado Pago pero no acreditado por nuestra validación.
    if (p.status === "approved") {
      const why = p.live_mode === false ? "pago_de_prueba" : "validacion";
      return NextResponse.redirect(`${site}/comprar-creditos?mp=rechazado&motivo=${why}`, 303);
    }
  } catch (e) {
    console.error("[mercadopago] retorno:", e instanceof Error ? e.message : e);
  }
  return NextResponse.redirect(`${site}/comprar-creditos?error=pago&mp=${encodeURIComponent(status.replace(/[^a-z_]/gi, ""))}`, 303);
}
