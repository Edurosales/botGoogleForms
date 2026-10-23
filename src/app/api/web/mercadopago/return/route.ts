import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";
import { processMercadoPagoPayment } from "@/lib/mpFulfill";
import { takeReturnTo, withQuery } from "@/lib/returnTo";

/**
 * Vuelta desde Checkout Pro. Mercado Pago agrega ?payment_id=&status=&
 * external_reference=. Nunca se cree en esos parámetros: se consulta el pago
 * a la API (igual que el webhook, idempotente) y recién ahí se acredita.
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
    if (status === "pending" || status === "in_process") {
      return NextResponse.redirect(`${site}/comprar-creditos?mp=pendiente&pedido=${encodeURIComponent(ref)}`, 303);
    }
  } catch (e) {
    console.error("[mercadopago] retorno:", e instanceof Error ? e.message : e);
  }
  return NextResponse.redirect(`${site}/comprar-creditos?error=pago`, 303);
}
