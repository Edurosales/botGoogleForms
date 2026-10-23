/**
 * Procesa un pago de Mercado Pago consultándolo SIEMPRE a la API (webhook y
 * retorno del navegador llaman aquí): acredita, rechaza o registra la
 * devolución con las mismas funciones que Izipay.
 */
import { getPayment, mpIsRefund, mpPaymentProblem } from "./mercadopago";
import { creditPaidOrder, findCreditOrder, refundCreditOrder, rejectCreditOrder, type FulfillResult } from "./webFulfill";
import { db } from "./db";

export async function processMercadoPagoPayment(paymentId: string): Promise<FulfillResult> {
  const p = await getPayment(paymentId);
  const orderId = p.external_reference || "";
  if (!/^WB-\d{8}-[0-9A-F]{6}$/.test(orderId)) return { ok: false, reason: "pago sin pedido de créditos" };
  const order = await findCreditOrder(orderId);
  if (!order) return { ok: false, orderId, reason: "orden desconocida" };

  // Registro del aviso (como izipay_events) para verlo en el admin.
  await db()
    .from("izipay_events")
    .insert({
      order_id: orderId,
      order_status: `MP:${p.status}`,
      transactions: `${p.payment_type_id ?? ""} ${p.payment_method_id ?? ""} ${p.transaction_amount} ${p.currency_id} live=${p.live_mode}`.trim(),
      result: p.status_detail ?? "",
    })
    .then(
      () => {},
      () => {}
    );

  if (mpIsRefund(p) && order.status !== "pending") return refundCreditOrder(order, "mercadopago");

  const problem = mpPaymentProblem(p, orderId, order.amount_cents, order.currency);
  if (problem) {
    // Pendiente / en proceso (ej. PagoEfectivo sin pagar aún): no se marca fallido.
    const final = p.status === "rejected" || p.status === "cancelled";
    return rejectCreditOrder(order, "mercadopago", problem, final, p);
  }
  return creditPaidOrder(order, "mercadopago", String(p.id), p);
}
