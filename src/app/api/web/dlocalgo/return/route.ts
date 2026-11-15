import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";
import { findCreditOrder } from "@/lib/webFulfill";
import { processDlocalPayment } from "@/lib/dlocalFulfill";
import { takeReturnTo, withQuery } from "@/lib/returnTo";

/**
 * Vuelta desde el checkout de dLocal Go (success_url con ?pedido=WB-…).
 * Nunca se cree en la URL: se busca el pago guardado en la orden y se
 * consulta a la API (igual que la notificación, idempotente).
 */
export async function GET(req: Request) {
  const site = siteUrl();
  const orderId = new URL(req.url).searchParams.get("pedido") || "";
  if (!/^WB-\d{8}-[0-9A-F]{6}$/.test(orderId)) return NextResponse.redirect(`${site}/comprar-creditos/pagar?dl=cancelado`, 303);
  try {
    const order = await findCreditOrder(orderId);
    if (order?.status === "paid") {
      const back = await takeReturnTo(orderId);
      return NextResponse.redirect(`${site}${withQuery(back, "pagado", orderId)}`, 303);
    }
    const paymentId = String((order as { izipay_uuid?: string } | null)?.izipay_uuid ?? "");
    if (!order || !paymentId) return NextResponse.redirect(`${site}/comprar-creditos/pagar?dl=pendiente`, 303);
    const r = await processDlocalPayment(paymentId);
    if (r.ok) {
      const back = await takeReturnTo(orderId);
      return NextResponse.redirect(`${site}${withQuery(back, "pagado", orderId)}`, 303);
    }
    if (r.status === "PENDING") return NextResponse.redirect(`${site}/comprar-creditos/pagar?dl=pendiente`, 303);
    if (r.status === "REJECTED" || r.status === "CANCELLED" || r.status === "EXPIRED") {
      return NextResponse.redirect(`${site}/comprar-creditos/pagar?dl=rechazado`, 303);
    }
  } catch (e) {
    console.error("[dlocalgo] retorno:", e instanceof Error ? e.message : e);
  }
  return NextResponse.redirect(`${site}/comprar-creditos/pagar?dl=pendiente`, 303);
}
