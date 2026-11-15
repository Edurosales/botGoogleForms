/**
 * Procesa un pago de dLocal Go consultándolo SIEMPRE a la API (notificación y
 * retorno del navegador llaman aquí): acredita o rechaza con las mismas
 * funciones que Izipay y Mercado Pago (idempotente: acreditar dos veces no suma dos veces).
 */
import { dlocalPaymentProblem, getDlocalPayment } from "./dlocalgo";
import { creditPaidOrder, findCreditOrder, rejectCreditOrder, type FulfillResult } from "./webFulfill";
import { db } from "./db";

export async function processDlocalPayment(paymentId: string): Promise<FulfillResult & { status?: string; detail?: string }> {
  const p = await getDlocalPayment(paymentId);
  const orderId = p.order_id || "";
  if (!/^WB-\d{8}-[0-9A-F]{6}$/.test(orderId)) return { ok: false, reason: "pago sin pedido de créditos", status: p.status };
  const order = await findCreditOrder(orderId);
  if (!order) return { ok: false, orderId, reason: "orden desconocida", status: p.status };

  // Registro del aviso (como izipay_events) para verlo en el admin.
  await db()
    .from("izipay_events")
    .insert({
      order_id: orderId,
      order_status: `DLOCAL:${p.status}`,
      transactions: `${p.id} ${p.amount} ${p.currency}`.trim(),
      result: p.status_detail ?? "",
    })
    .then(
      () => {},
      () => {}
    );

  const problem = dlocalPaymentProblem(p, orderId, order.amount_cents, order.currency);
  if (problem) {
    // PENDING (ej. pago en efectivo aún sin pagar): no se marca fallido.
    const final = p.status === "REJECTED" || p.status === "CANCELLED" || p.status === "EXPIRED";
    const r = await rejectCreditOrder(order, "dlocalgo", problem, final, p);
    return { ...r, orderId, status: p.status, detail: p.status_detail ?? "" };
  }
  const r = await creditPaidOrder(order, "dlocalgo", p.id, p);
  return { ...r, orderId, status: p.status };
}
